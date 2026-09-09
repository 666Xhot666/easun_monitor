import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { InverterService } from './inverter.service';

const INTERVAL_NAME_PREFIX = 'inverter-poll-';

interface PollTarget {
  ipAddress: string;
  port: number;
}

/**
 * Drives one concurrent poll loop per paired inverter and persists
 * successful reads, tagged with which InverterProfile they came from.
 * Multiple users can each pair one or more inverters — every
 * InverterProfile row in the database gets its own independent
 * `setInterval`, running side by side against InverterService's
 * per-device connection pool (see InverterService's `connections` map),
 * so a slow or unreachable device never blocks or delays polling for any
 * other device.
 *
 * Deliberately does NOT fall back to any .env-configured address when no
 * InverterProfile exists: every reading this service ever stores is
 * tagged with the InverterProfile (and therefore the user) it came from,
 * with no exception — an "ownerless" reading polled straight from .env
 * would be data nobody's account can see or manage, which directly
 * contradicts the whole point of this being a per-user, multi-inverter
 * system. If there are no profiles yet, polling is simply idle until
 * someone completes the setup wizard.
 *
 * The interval length itself is still one global `POLLING_INTERVAL_MS`
 * (read at startup, hence the SchedulerRegistry/setInterval approach
 * rather than a compile-time `@Cron`/`@Interval`) — every device is
 * polled on the same cadence, just not the same tick.
 */
@Injectable()
export class PollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollingService.name);
  private readonly pollIntervalMs: number;

  // profileId -> the address we're currently polling for it. Mirrors
  // exactly which SchedulerRegistry intervals are running, so
  // syncProfiles() can diff against the database without needing to ask
  // SchedulerRegistry what it already knows.
  private readonly tracked = new Map<number, PollTarget>();
  // Per-profile re-entrancy guard — a slow poll for one device must never
  // cause another device's tick to be skipped, so this can't be a single
  // shared boolean the way a one-inverter version of this service could
  // get away with.
  private readonly pollingInFlight = new Set<number>();

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly inverterService: InverterService,
    private readonly prisma: PrismaService,
  ) {
    const rawInterval = this.configService.get<string>('POLLING_INTERVAL_MS');
    const parsedInterval = Number(rawInterval);
    const isValid =
      rawInterval !== undefined &&
      Number.isFinite(parsedInterval) &&
      parsedInterval > 0;

    if (!isValid) {
      throw new Error(
        `POLLING_INTERVAL_MS is not set to a valid positive number ` +
          `(got "${rawInterval}"). Configure it in your .env file before ` +
          `starting the server.`,
      );
    }
    this.pollIntervalMs = parsedInterval;
  }

  async onModuleInit(): Promise<void> {
    await this.syncProfiles();
  }

  onModuleDestroy(): void {
    for (const profileId of this.tracked.keys()) {
      this.stopPolling(profileId);
    }
  }

  /**
   * Re-reads every InverterProfile in the database — across all users,
   * since each paired inverter gets its own poll loop regardless of who
   * owns it — and reconciles the running intervals against it: starts
   * polling any newly-paired profile, stops polling any profile that no
   * longer exists (deleted), and restarts polling for a profile whose
   * ip/port changed (edited). Safe to call at any time; the controller
   * calls this right after a profile is created, updated, or deleted so
   * the change takes effect immediately instead of requiring a server
   * restart.
   */
  async syncProfiles(): Promise<void> {
    const profiles = await this.prisma.inverterProfile.findMany();

    const desired = new Map<number, PollTarget>();
    for (const profile of profiles) {
      desired.set(profile.id, { ipAddress: profile.ipAddress, port: profile.port });
    }

    // Stop anything currently running that's no longer desired.
    for (const profileId of this.tracked.keys()) {
      if (!desired.has(profileId)) {
        this.stopPolling(profileId);
      }
    }

    // Start anything newly desired, and restart anything whose target
    // address changed since it was last (re)started.
    for (const [profileId, target] of desired) {
      const current = this.tracked.get(profileId);
      const changed =
        !current || current.ipAddress !== target.ipAddress || current.port !== target.port;
      if (changed) {
        if (current) this.stopPolling(profileId);
        this.startPolling(profileId, target);
      }
    }

    if (desired.size === 0) {
      this.logger.log('No inverter profiles paired yet — polling idle until someone completes setup.');
    }
  }

  private startPolling(profileId: number, target: PollTarget): void {
    this.tracked.set(profileId, target);

    const interval = setInterval(() => {
      void this.poll(profileId, target);
    }, this.pollIntervalMs);

    this.schedulerRegistry.addInterval(this.intervalName(profileId), interval);
    this.logger.log(
      `Polling inverter at ${target.ipAddress}:${target.port} every ${this.pollIntervalMs}ms (profile #${profileId})`,
    );

    // Run one poll immediately instead of waiting a full interval for the
    // first reading.
    void this.poll(profileId, target);
  }

  private stopPolling(profileId: number): void {
    const name = this.intervalName(profileId);
    if (this.schedulerRegistry.doesExist('interval', name)) {
      this.schedulerRegistry.deleteInterval(name);
    }
    this.tracked.delete(profileId);
    this.pollingInFlight.delete(profileId);
  }

  private intervalName(profileId: number): string {
    return `${INTERVAL_NAME_PREFIX}${profileId}`;
  }

  /**
   * One poll cycle for one device: fetch, then persist. Never throws —
   * any failure (a dropped Wi-Fi connection, a timeout, a DB error) is
   * logged and swallowed here so a bad cycle for one device can't crash
   * the process or stop either its own timer or any other device's timer
   * from firing again.
   */
  private async poll(profileId: number, target: PollTarget): Promise<void> {
    if (this.pollingInFlight.has(profileId)) {
      this.logger.warn(
        `Previous poll for profile #${profileId} still in flight — skipping this tick`,
      );
      return;
    }
    this.pollingInFlight.add(profileId);

    try {
      const reading = await this.inverterService.fetchDeviceData(
        target.ipAddress,
        target.port,
      );

      await this.prisma.inverterLog.create({
        data: {
          payload: reading,
          inverterProfileId: profileId,
        },
      });

      this.logger.debug(
        `Profile #${profileId}: stored reading with ${Object.keys(reading).length} parameter(s)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Poll cycle failed for profile #${profileId}: ${message}`);
      // Intentionally not rethrown — see method doc above.
    } finally {
      this.pollingInFlight.delete(profileId);
    }
  }
}
