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

const POLL_INTERVAL_NAME = 'inverter-poll';

/**
 * Drives the polling loop against the inverter and persists successful
 * reads. The interval is read from `POLLING_INTERVAL_MS` at startup, so it
 * can't be expressed with a static `@Cron`/`@Interval` decorator (those need
 * a compile-time value) — instead we register a plain `setInterval` with
 * Nest's SchedulerRegistry, which gives us the same lifecycle/inspection
 * benefits (`docs compose exec server` + Nest Devtools can see it as
 * "inverter-poll") without hardcoding the cadence.
 */
@Injectable()
export class PollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollingService.name);
  private readonly inverterIp: string;
  private readonly pollIntervalMs: number;

  // Re-entrancy guard: if a poll ever takes longer than the interval (e.g.
  // the device is timing out), this skips the next tick instead of piling
  // up overlapping requests against the same inverter connection.
  private isPolling = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly inverterService: InverterService,
    private readonly prisma: PrismaService,
  ) {
    // Fail fast and loudly at boot if required config is missing, rather
    // than silently polling a blank address forever. docker-compose.yml
    // already guards INVERTER_IP with `:?`, so in the normal Docker flow
    // this can only trip when running the compiled app outside Docker
    // without a real .env — which is exactly when you want a clear error.
    const ip = this.configService.get<string>('INVERTER_IP');
    if (!ip) {
      throw new Error(
        'INVERTER_IP is not set. Configure it in your .env file before starting the server.',
      );
    }
    this.inverterIp = ip;

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

  onModuleInit(): void {
    const interval = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);

    this.schedulerRegistry.addInterval(POLL_INTERVAL_NAME, interval);
    this.logger.log(
      `Polling inverter at ${this.inverterIp} every ${this.pollIntervalMs}ms`,
    );

    // Run one poll immediately instead of waiting a full interval for the
    // first reading.
    void this.poll();
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', POLL_INTERVAL_NAME)) {
      this.schedulerRegistry.deleteInterval(POLL_INTERVAL_NAME);
    }
  }

  /**
   * One poll cycle: fetch, then persist. Never throws — any failure (a
   * dropped Wi-Fi connection, a timeout, a DB error) is logged and
   * swallowed here so a single bad cycle can't crash the process or stop
   * the timer from firing again.
   */
  private async poll(): Promise<void> {
    if (this.isPolling) {
      this.logger.warn('Previous poll still in flight — skipping this tick');
      return;
    }
    this.isPolling = true;

    try {
      const reading = await this.inverterService.fetchDeviceData(
        this.inverterIp,
      );

      await this.prisma.inverterLog.create({ data: { payload: reading } });

      this.logger.debug(
        `Stored reading with ${Object.keys(reading).length} parameter(s)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Poll cycle failed: ${message}`);
      // Intentionally not rethrown — see method doc above.
    } finally {
      this.isPolling = false;
    }
  }
}
