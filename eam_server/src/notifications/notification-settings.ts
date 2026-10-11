import type { AlertKind } from '../alerts/alert-kind';
import type { ServerNoticeKind } from '../server-monitor/server-alerts';

/** What can be sent: each kind of alert, and the evening summary. */
export type NotificationKind = AlertKind | ServerNoticeKind | 'summary';
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'fault',
  'warning',
  'grid',
  'battery',
  'connection',
  'schedule',
  'outage',
  'schedule-unavailable',
  'server-heat',
  'server-storage',
  'server-memory',
  'server-agent',
  'server-updates',
  'summary',
];

export interface Channels {
  /** The bell and, when installed, push on the phone. */
  inApp: boolean;
  telegram: boolean;
}

/** One user's notification choices. */
export interface NotificationSettings {
  channels: Record<NotificationKind, Channels>;
  /** From 23:00 to 07:00 only faults and overheating reach Telegram. */
  quietHours: boolean;
  /** How long before an outage starts the "Outage in" notice comes. */
  outageLeadMinutes: number;
  /** The notice also before possible outages, not only confirmed ones. */
  possibleOutages: boolean;
}

/** What everyone had before there were settings: Telegram gets everything. */
export const DEFAULT_SETTINGS: NotificationSettings = {
  channels: {
    fault: { inApp: true, telegram: true },
    warning: { inApp: true, telegram: true },
    grid: { inApp: true, telegram: true },
    battery: { inApp: true, telegram: true },
    connection: { inApp: true, telegram: true },
    schedule: { inApp: true, telegram: true },
    outage: { inApp: true, telegram: true },
    'schedule-unavailable': { inApp: true, telegram: true },
    'server-heat': { inApp: true, telegram: true },
    'server-storage': { inApp: true, telegram: true },
    'server-memory': { inApp: true, telegram: true },
    'server-agent': { inApp: true, telegram: true },
    'server-updates': { inApp: true, telegram: true },
    summary: { inApp: false, telegram: true },
  },
  quietHours: false,
  outageLeadMinutes: 15,
  possibleOutages: false,
};

export const OUTAGE_LEAD_MINUTES = { min: 1, max: 120 };

/** What gets through quiet hours. */
const URGENT = new Set<NotificationKind>(['fault', 'server-heat']);

const QUIET_FROM_HOUR = 23;
const QUIET_UNTIL_HOUR = 7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isLeadMinutes = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= OUTAGE_LEAD_MINUTES.min &&
  (value as number) <= OUTAGE_LEAD_MINUTES.max;

/** `patch` applied over `base`, keeping only known kinds and valid values. */
export function mergeSettings(
  base: NotificationSettings,
  patch: unknown,
): NotificationSettings {
  const channels = {} as Record<NotificationKind, Channels>;
  const patchChannels =
    isRecord(patch) && isRecord(patch.channels) ? patch.channels : {};
  for (const kind of NOTIFICATION_KINDS) {
    const current = {
      ...DEFAULT_SETTINGS.channels[kind],
      ...(isRecord(base.channels) ? base.channels[kind] : {}),
    };
    const change = isRecord(patchChannels[kind]) ? patchChannels[kind] : {};
    channels[kind] = {
      inApp: typeof change.inApp === 'boolean' ? change.inApp : current.inApp,
      telegram:
        typeof change.telegram === 'boolean'
          ? change.telegram
          : current.telegram,
    };
  }
  const quietHours =
    isRecord(patch) && typeof patch.quietHours === 'boolean'
      ? patch.quietHours
      : base.quietHours === true;
  const pick = <T>(
    key: 'outageLeadMinutes' | 'possibleOutages',
    valid: (v: unknown) => v is T,
  ): T =>
    isRecord(patch) && valid(patch[key])
      ? patch[key]
      : valid(base[key])
        ? base[key]
        : (DEFAULT_SETTINGS[key] as T);
  const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
  return {
    channels,
    quietHours,
    outageLeadMinutes: pick('outageLeadMinutes', isLeadMinutes),
    possibleOutages: pick('possibleOutages', isBoolean),
  };
}

/** The hour of `at` on the clock of `timeZone`. */
function hourIn(at: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).format(at),
  );
}

/** Whether a notification of `kind` goes to this user's Telegram chat at `at`. */
export function sendsToTelegram(
  settings: NotificationSettings,
  kind: NotificationKind,
  at: Date,
  timeZone: string,
): boolean {
  if (!settings.channels[kind].telegram) return false;
  if (!settings.quietHours || URGENT.has(kind)) return true;
  const hour = hourIn(at, timeZone);
  return !(hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR);
}
