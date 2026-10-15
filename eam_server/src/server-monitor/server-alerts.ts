import type { AlertMessage } from '../alerts/alert-message';
import type { HostSample } from '../server-agent/sample';

/** The owner's limits for the server notices. */
export interface AlertThresholds {
  /** Overheating at or above this, on any sensor. */
  heatC: number;
  /** Storage low below this share free, on any filesystem. */
  storageFreePercent: number;
  /** Memory short at or above this share used. */
  memoryUsedPercent: number;
}

export type ServerNoticeKind =
  | 'server-heat'
  | 'server-storage'
  | 'server-memory'
  | 'server-agent'
  | 'server-updates';

/** A notice: an alert message (texts under "alerts" in src/i18n/locales) of a kind. */
export interface ServerNotice extends AlertMessage {
  kind: ServerNoticeKind;
}

/** What the previous samples showed, to tell changes. */
export interface AlertState {
  hotStreak: number;
  hot: boolean;
  /** Mount points reported low. */
  lowDisks: string[];
  memoryStreak: number;
  memoryShort: boolean;
  security: number | null;
  rebootRequired: boolean | null;
}

/** Overheating needs this many hot readings in a row; memory this many over the limit. */
const HOT_READINGS = 2;
const MEMORY_READINGS = 5;
/** How far back below (or above, for free storage) the limit a notice is over. */
const HEAT_MARGIN_C = 5;
const STORAGE_MARGIN = 2;
const MEMORY_MARGIN = 5;

/** To one decimal, as notices show it. */
const tenth = (v: number) => Math.round(v * 10) / 10;

/**
 * The notices one sample brings, given the state the earlier ones left. The
 * first sample (no state) is the baseline: nothing is reported for it.
 */
export function serverAlerts(
  previous: AlertState | undefined,
  sample: HostSample,
  limits: AlertThresholds,
): { state: AlertState; notices: ServerNotice[] } {
  const notices: ServerNotice[] = [];
  const say = (
    kind: ServerNoticeKind,
    key: string,
    params?: AlertMessage['params'],
  ) => {
    if (previous) notices.push({ kind, key, params });
  };

  // Heat: the hottest sensor.
  const hottest = sample.temperatures.reduce<
    HostSample['temperatures'][number] | null
  >((max, t) => (!max || t.celsius > max.celsius ? t : max), null);
  const isHot = hottest !== null && hottest.celsius >= limits.heatC;
  const hotStreak = isHot ? (previous?.hotStreak ?? HOT_READINGS - 1) + 1 : 0;
  let hot = previous?.hot ?? isHot;
  if (!hot && hotStreak >= HOT_READINGS && hottest) {
    hot = true;
    say('server-heat', 'serverHot', {
      celsius: hottest.celsius,
      sensor: hottest.label,
    });
  } else if (hot && hottest && hottest.celsius < limits.heatC - HEAT_MARGIN_C) {
    hot = false;
    say('server-heat', 'serverCool', { celsius: hottest.celsius });
  }

  // Storage: each filesystem.
  const lowDisks: string[] = [];
  for (const disk of sample.disks) {
    if (disk.totalBytes <= 0) continue;
    const free = (disk.freeBytes / disk.totalBytes) * 100;
    const wasLow = previous ? previous.lowDisks.includes(disk.mount) : false;
    if (wasLow) {
      if (free >= limits.storageFreePercent + STORAGE_MARGIN) {
        say('server-storage', 'serverStorageBack', {
          mount: disk.mount,
          freePercent: tenth(free),
        });
      } else {
        lowDisks.push(disk.mount);
      }
    } else if (free < limits.storageFreePercent) {
      lowDisks.push(disk.mount);
      say('server-storage', 'serverStorageLow', {
        mount: disk.mount,
        freePercent: tenth(free),
        freeGb: Math.round(disk.freeBytes / 1e9),
      });
    }
  }

  // Memory: used, over several readings.
  const { totalBytes, availableBytes, swapTotalBytes, swapFreeBytes } =
    sample.memory;
  const used = totalBytes > 0 ? (1 - availableBytes / totalBytes) * 100 : 0;
  const isShort = used >= limits.memoryUsedPercent;
  const memoryStreak = isShort
    ? (previous ? previous.memoryStreak : MEMORY_READINGS - 1) + 1
    : 0;
  let memoryShort = previous?.memoryShort ?? isShort;
  if (!memoryShort && memoryStreak >= MEMORY_READINGS) {
    memoryShort = true;
    say('server-memory', 'serverMemoryShort', {
      usedPercent: tenth(used),
      swapGb: tenth((swapTotalBytes - swapFreeBytes) / 1e9),
    });
  } else if (memoryShort && used < limits.memoryUsedPercent - MEMORY_MARGIN) {
    memoryShort = false;
    say('server-memory', 'serverMemoryBack', { usedPercent: tenth(used) });
  }

  // Updates: when the agent has checked.
  let security = previous?.security ?? null;
  let rebootRequired = previous?.rebootRequired ?? null;
  const updates = sample.updates;
  if (updates) {
    if (security !== null && updates.security > security) {
      say('server-updates', 'serverSecurityUpdates', {
        count: updates.security,
        packages: updates.packages,
      });
    }
    if (rebootRequired === false && updates.rebootRequired) {
      say('server-updates', 'serverRestart');
    }
    security = updates.security;
    rebootRequired = updates.rebootRequired;
  }

  return {
    state: {
      hotStreak,
      hot,
      lowDisks,
      memoryStreak,
      memoryShort,
      security,
      rebootRequired,
    },
    notices,
  };
}
