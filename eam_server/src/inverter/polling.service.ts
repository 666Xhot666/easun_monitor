import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryStore } from '../telemetry/telemetry.store';
import { LoggerLinks } from './link/logger-links';
import { LoggerUnavailableError } from './link/logger-link';
import { SettingsService } from './settings.service';

const INTERVAL_NAME_PREFIX = 'inverter-poll-';
const SETTINGS_INTERVAL_PREFIX = 'inverter-settings-';
const DEFAULT_SETTINGS_REFRESH_MS = 5 * 60_000;

interface PollTarget {
  ipAddress: string;
  port: number;
}

/**
 * Runs one poll cycle per paired inverter profile (all users) every
 * POLLING_INTERVAL_MS: reads the telemetry and status registers through
 * that logger's Logger link and records the reading in the Telemetry
 * store. Settings change only when edited, so they are re-read on a
 * separate, slow cadence (SETTINGS_REFRESH_MS, default five minutes).
 *
 * The link serializes requests and backs off from an unreachable logger,
 * so a dead device costs one short failed attempt per backoff window
 * rather than a timeout per register, and never delays other devices.
 */
@Injectable()
export class PollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollingService.name);
  private readonly pollIntervalMs: number;
  private readonly settingsRefreshMs: number;

  /** profileId -> the address currently polled for it. */
  private readonly tracked = new Map<number, PollTarget>();
  private readonly pollingInFlight = new Set<number>();
  /** Last reported availability per profile, so logs record changes only. */
  private readonly lastReported = new Map<number, 'up' | 'down'>();

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly links: LoggerLinks,
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryStore,
    private readonly settings: SettingsService,
  ) {
    const rawInterval = this.configService.get<string>('POLLING_INTERVAL_MS');
    const parsedInterval = Number(rawInterval);
    if (rawInterval === undefined || !Number.isFinite(parsedInterval) || parsedInterval <= 0) {
      throw new Error(
        `POLLING_INTERVAL_MS is not set to a valid positive number (got "${rawInterval}"). ` +
          `Configure it in your .env file before starting the server.`,
      );
    }
    this.pollIntervalMs = parsedInterval;

    const settingsRefresh = Number(this.configService.get<string>('SETTINGS_REFRESH_MS'));
    this.settingsRefreshMs =
      Number.isFinite(settingsRefresh) && settingsRefresh > 0
        ? settingsRefresh
        : DEFAULT_SETTINGS_REFRESH_MS;
  }

  async onModuleInit(): Promise<void> {
    await this.syncProfiles();
  }

  onModuleDestroy(): void {
    for (const profileId of [...this.tracked.keys()]) {
      this.stopPolling(profileId);
    }
  }

  /**
   * Reconciles the running poll loops with the InverterProfile table:
   * starts new profiles, stops deleted ones, restarts moved ones. Called at
   * start-up and after every profile create, update or delete.
   */
  async syncProfiles(): Promise<void> {
    const profiles = await this.prisma.inverterProfile.findMany();
    const desired = new Map<number, PollTarget>(
      profiles.map((p) => [p.id, { ipAddress: p.ipAddress, port: p.port }]),
    );

    for (const profileId of [...this.tracked.keys()]) {
      if (!desired.has(profileId)) this.stopPolling(profileId);
    }
    for (const [profileId, target] of desired) {
      const current = this.tracked.get(profileId);
      if (!current || current.ipAddress !== target.ipAddress || current.port !== target.port) {
        if (current) this.stopPolling(profileId);
        this.startPolling(profileId, target);
      }
    }

    if (desired.size === 0) {
      this.logger.log('No inverter profiles paired yet; polling is idle until setup completes.');
    }
  }

  private startPolling(profileId: number, target: PollTarget): void {
    this.tracked.set(profileId, target);
    const interval = setInterval(() => void this.poll(profileId, target), this.pollIntervalMs);
    this.schedulerRegistry.addInterval(`${INTERVAL_NAME_PREFIX}${profileId}`, interval);
    const settingsInterval = setInterval(
      () => void this.refreshSettings(profileId, target),
      this.settingsRefreshMs,
    );
    this.schedulerRegistry.addInterval(`${SETTINGS_INTERVAL_PREFIX}${profileId}`, settingsInterval);
    this.logger.log(
      `Polling ${target.ipAddress}:${target.port} every ${this.pollIntervalMs}ms (profile #${profileId})`,
    );
    void this.poll(profileId, target).then(() => this.refreshSettings(profileId, target, false));
  }

  private stopPolling(profileId: number): void {
    for (const prefix of [INTERVAL_NAME_PREFIX, SETTINGS_INTERVAL_PREFIX]) {
      const name = `${prefix}${profileId}`;
      if (this.schedulerRegistry.doesExist('interval', name)) {
        this.schedulerRegistry.deleteInterval(name);
      }
    }
    const target = this.tracked.get(profileId);
    this.tracked.delete(profileId);
    this.pollingInFlight.delete(profileId);
    this.lastReported.delete(profileId);
    if (target) this.links.remove(target.ipAddress, target.port);
  }

  /** One poll cycle. Never throws: failures are logged and the next tick
   * tries again (subject to the link's backoff). */
  private async poll(profileId: number, target: PollTarget): Promise<void> {
    if (this.pollingInFlight.has(profileId)) return;
    this.pollingInFlight.add(profileId);
    try {
      const reading = await this.links
        .get(target.ipAddress, target.port)
        .read(['telemetry', 'status']);
      if (Object.keys(reading).length > 0) {
        await this.telemetry.record(profileId, reading);
      }
      this.report(profileId, 'up', `Profile #${profileId}: logger reachable`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof LoggerUnavailableError) {
        this.report(profileId, 'down', `Profile #${profileId}: ${message}`);
      } else {
        this.logger.error(`Poll cycle failed for profile #${profileId}: ${message}`);
      }
    } finally {
      this.pollingInFlight.delete(profileId);
    }
  }

  /** Slow-cadence settings read; failures just wait for the next one
   * (availability is already reported by the telemetry cycle). */
  private async refreshSettings(profileId: number, target: PollTarget, force = true): Promise<void> {
    if (!this.tracked.has(profileId)) return;
    const profile = { id: profileId, ...target };
    try {
      // The first read after pairing only fills an empty cache; the slow
      // cadence always re-reads.
      await (force ? this.settings.refresh(profile) : this.settings.get(profile));
    } catch {
      // Logger unreachable or a block refused: keep the last snapshot.
    }
  }

  private report(profileId: number, state: 'up' | 'down', message: string): void {
    if (this.lastReported.get(profileId) === state) return;
    this.lastReported.set(profileId, state);
    if (state === 'up') this.logger.log(message);
    else this.logger.warn(message);
  }
}
