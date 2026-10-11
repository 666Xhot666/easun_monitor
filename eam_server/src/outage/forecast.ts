import type { DaySlots } from '../outage-reader/dnem/schedule-page';
import {
  KYIV,
  localDateOf,
  mergeWindows,
  nextDay,
  wallToUtc,
  weeklyWindows,
  type LocalDate,
  type WindowStatus,
} from '../outage-reader/dnem/windows';

/** Without a successful check for this long, the data is stale. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** What the forecast is made from, as stored for one source. */
export interface ForecastInput {
  source: {
    enabled: boolean;
    houseState: 'PENDING' | 'FOUND' | 'NOT_FOUND';
    groups: string[];
  } | null;
  lastCheck: { checkedAt: Date; outcome: string; error: string | null } | null;
  lastOkAt: Date | null;
  /** Events of the source overlapping the range, not withdrawn. */
  events: Array<{
    kind: 'SCHEDULE' | 'REPAIR';
    status: 'OFF' | 'POSSIBLE' | 'UNKNOWN';
    description: string | null;
    start: Date;
    end: Date;
  }>;
  /** The latest weekly pattern of each of the house's groups. */
  weekly: Record<string, Record<number, DaySlots>>;
  /** Kyiv days (YYYY-MM-DD) with a confirmed schedule for the house's groups. */
  coveredDays: string[];
}

export interface ForecastWindow {
  start: Date;
  end: Date;
  status: WindowStatus;
  /** schedule: the confirmed schedule; repair: a repair on the house; weekly: the weekly pattern only. */
  source: 'schedule' | 'repair' | 'weekly';
  description: string | null;
}

/**
 * fresh / stale: windows are given (stale: from the last successful check,
 * which may be none). The others have no windows: no address set, switched
 * off, house not looked up yet, not on the site, or on no group.
 */
export type ForecastState =
  | 'fresh'
  | 'stale'
  | 'none'
  | 'disabled'
  | 'pending'
  | 'not-found'
  | 'no-groups';

export interface OutageForecast {
  state: ForecastState;
  groups: string[];
  lastOkAt: Date | null;
  dataAgeMinutes: number | null;
  lastCheck: ForecastInput['lastCheck'];
  windows: ForecastWindow[];
  /** What is scheduled at `now`: unknown when there is no data to tell. */
  now: { status: 'on' | WindowStatus; window: ForecastWindow | null };
  /** The next outage (off or possible) starting after `now`. */
  next: ForecastWindow | null;
}

const STATUS_RANK: Record<WindowStatus, number> = {
  off: 0,
  possible: 1,
  unknown: 2,
};
const SOURCE_RANK: Record<ForecastWindow['source'], number> = {
  repair: 0,
  schedule: 1,
  weekly: 2,
};
const stronger = (a: ForecastWindow, b: ForecastWindow) =>
  STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
  SOURCE_RANK[a.source] - SOURCE_RANK[b.source];

/**
 * The outage windows of one source over [from, to): the confirmed schedule
 * and repairs where known, the weekly pattern on days without a confirmed
 * schedule. Callers must not take stale or missing data as "power on".
 */
export function buildForecast(
  input: ForecastInput,
  from: Date,
  to: Date,
  now: Date,
  timeZone = KYIV,
): OutageForecast {
  const { source, lastOkAt } = input;
  const base = {
    groups: source?.groups ?? [],
    lastOkAt,
    dataAgeMinutes: lastOkAt
      ? Math.floor((now.getTime() - lastOkAt.getTime()) / 60_000)
      : null,
    lastCheck: input.lastCheck,
  };
  const empty = (state: ForecastState): OutageForecast => ({
    ...base,
    state,
    windows: [],
    now: { status: 'unknown', window: null },
    next: null,
  });

  if (!source) return empty('none');
  if (!source.enabled) return empty('disabled');
  if (source.houseState === 'PENDING') return empty('pending');
  if (source.houseState === 'NOT_FOUND') return empty('not-found');
  if (source.groups.length === 0) return empty('no-groups');

  // Nothing to go by before the first successful check.
  if (!lastOkAt) return empty('stale');
  const stale = now.getTime() - lastOkAt.getTime() > STALE_AFTER_MS;

  const windows: ForecastWindow[] = [
    ...input.events.map((e) => ({
      start: e.start,
      end: e.end,
      status: e.status.toLowerCase() as WindowStatus,
      source: e.kind === 'REPAIR' ? ('repair' as const) : ('schedule' as const),
      description: e.description,
    })),
    ...uncoveredWeekly(input, from, to, timeZone),
  ].sort((a, b) => a.start.getTime() - b.start.getTime() || stronger(a, b));

  const current = windows
    .filter((w) => w.start <= now && now < w.end)
    .sort(stronger)[0];
  return {
    ...base,
    state: stale ? 'stale' : 'fresh',
    windows,
    now: current
      ? { status: current.status, window: current }
      : { status: 'on', window: null },
    next:
      windows.find(
        (w) => w.start > now && (w.status === 'off' || w.status === 'possible'),
      ) ?? null,
  };
}

/** The weekly pattern of the house's groups, on the days of [from, to) without a confirmed schedule. */
function uncoveredWeekly(
  input: ForecastInput,
  from: Date,
  to: Date,
  timeZone: string,
): ForecastWindow[] {
  const covered = new Set(input.coveredDays);
  const weeks = Object.values(input.weekly);
  const found = [];
  const last = localDateOf(to, timeZone);
  for (let date = localDateOf(from, timeZone); ; date = nextDay(date)) {
    const start = new Date(
      Math.max(wallToUtc(date, 0, timeZone), from.getTime()),
    );
    const end = new Date(
      Math.min(wallToUtc(date, 24 * 60, timeZone), to.getTime()),
    );
    if (!covered.has(dayKey(date))) {
      for (const week of weeks) {
        found.push(...weeklyWindows(week, start, end, timeZone));
      }
    }
    if (dayKey(date) === dayKey(last)) break;
  }
  return mergeWindows(found).map((w) => ({
    start: w.start,
    end: w.end,
    status: w.status,
    source: 'weekly' as const,
    description: null,
  }));
}

function dayKey(d: LocalDate): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}
