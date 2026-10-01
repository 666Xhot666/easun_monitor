import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerLinks } from './link/logger-links';
import type { Reading } from './registers/register-map';
import { checkSettings, type SettingsCheck } from './settings-rules/settings-rules';
import { settingsConstraints, type InstallationProfile } from './settings-rules/smg-ii.settings-rules';

export interface SettingsSnapshot {
  /** Settings register name -> value, as read from the inverter. */
  values: Reading;
  /** When the values were read from the inverter (ISO 8601). */
  readAt: string;
}

interface LoggerAddress {
  id: number;
  ipAddress: string;
  port: number;
}

/** Changes were refused by the settings rules; nothing was written. */
export class SettingsRuleError extends Error {
  constructor(readonly check: SettingsCheck) {
    super('The changes break the settings rules');
    this.name = 'SettingsRuleError';
  }
}

const DEFAULT_MAX_AGE_MS = 5 * 60_000;

/**
 * The inverter's configuration, as last read from the device. Settings
 * change only when someone edits them (here or on the inverter's panel),
 * so they are read on demand, after every write, and on a slow schedule,
 * never on the fast telemetry cycle.
 */
@Injectable()
export class SettingsService {
  /** Keyed by profile and address, so moving a profile to another
   * logger never serves the previous device's settings. */
  private readonly cache = new Map<string, SettingsSnapshot>();
  /** Reads in progress, so concurrent refreshes share one device read. */
  private readonly inFlight = new Map<string, Promise<SettingsSnapshot>>();
  private readonly maxAgeMs: number;

  constructor(
    private readonly links: LoggerLinks,
    config: ConfigService,
  ) {
    const configured = Number(config.get<string>('SETTINGS_MAX_AGE_MS'));
    this.maxAgeMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_AGE_MS;
  }

  /** Cached settings if recent enough, otherwise read from the inverter. */
  async get(profile: LoggerAddress): Promise<SettingsSnapshot> {
    const cached = this.cache.get(cacheKey(profile));
    if (cached && Date.now() - Date.parse(cached.readAt) < this.maxAgeMs) {
      return cached;
    }
    return this.refresh(profile);
  }

  /** Reads every settings register from the inverter now. */
  refresh(profile: LoggerAddress): Promise<SettingsSnapshot> {
    const key = cacheKey(profile);
    let read = this.inFlight.get(key);
    if (!read) {
      read = (async () => {
        const values = await this.links.get(profile.ipAddress, profile.port).read(['settings']);
        const snapshot = { values, readAt: new Date().toISOString() };
        this.cache.set(key, snapshot);
        return snapshot;
      })().finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, read);
    }
    return read;
  }

  /**
   * Checks changed settings against the settings rules and the inverter's
   * current values, writes them, then re-reads all settings so the caller
   * sees what the inverter actually holds. Throws SettingsRuleError (an
   * error, or an unacknowledged warning; nothing sent), RegisterValueError
   * (invalid, nothing sent), LoggerFrameError (the inverter refused) or
   * LoggerUnavailableError.
   */
  async apply(
    profile: LoggerAddress & InstallationProfile,
    changes: Record<string, number>,
    acknowledgeWarnings = false,
  ): Promise<SettingsSnapshot> {
    const { values } = await this.get(profile);
    const check = checkSettings(settingsConstraints(profile), values, changes);
    const hasErrors = Object.keys(check.errors).length > 0;
    const hasWarnings = Object.keys(check.warnings).length > 0;
    if (hasErrors || (hasWarnings && !acknowledgeWarnings)) {
      throw new SettingsRuleError(check);
    }
    await this.links.get(profile.ipAddress, profile.port).write(changes);
    return this.refresh(profile);
  }
}

function cacheKey(profile: LoggerAddress): string {
  return `${profile.id}@${profile.ipAddress}:${profile.port}`;
}
