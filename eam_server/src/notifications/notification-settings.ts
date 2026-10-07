import type { AlertKind } from '../alerts/alert-kind';

/** What can be sent: each kind of alert, and the evening summary. */
export type NotificationKind = AlertKind | 'summary';
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'fault',
  'warning',
  'grid',
  'battery',
  'connection',
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
  /** From 23:00 to 07:00 only faults reach Telegram. */
  quietHours: boolean;
}

/** What everyone had before there were settings: Telegram gets everything. */
export const DEFAULT_SETTINGS: NotificationSettings = {
  channels: {
    fault: { inApp: true, telegram: true },
    warning: { inApp: true, telegram: true },
    grid: { inApp: true, telegram: true },
    battery: { inApp: true, telegram: true },
    connection: { inApp: true, telegram: true },
    summary: { inApp: false, telegram: true },
  },
  quietHours: false,
};

const QUIET_FROM_HOUR = 23;
const QUIET_UNTIL_HOUR = 7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `patch` applied over `base`, keeping only known kinds and boolean switches. */
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
  return { channels, quietHours };
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
  if (!settings.quietHours || kind === 'fault') return true;
  const hour = hourIn(at, timeZone);
  return !(hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR);
}
