import type { ConfirmedSchedule, DaySlots } from './schedule-page';
import type { SlotStatus } from './slot-status';

/**
 * Outage windows from the site's hourly slots. The site's hours are Kyiv wall
 * clock time; windows are real instants (UTC). On the day clocks go forward
 * the missing hour has no length and drops out; on the day they go back, the
 * repeated hour covers both of its runs, erring towards a longer outage (a
 * `first` half of that hour covers only its first run).
 */

export const KYIV = 'Europe/Kyiv';

export interface LocalDate {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

export type WindowStatus = 'off' | 'possible' | 'unknown';
export type WindowSource = 'confirmed' | 'weekly';

export interface OutageWindow {
  start: Date;
  end: Date;
  status: WindowStatus;
  source: WindowSource;
}

/** Status of a slot → the part of its hour it covers (minutes) and how sure. */
const PIECES: Record<SlotStatus, [number, number, WindowStatus] | null> = {
  yes: null,
  no: [0, 60, 'off'],
  first: [0, 30, 'off'],
  second: [30, 60, 'off'],
  maybe: [0, 60, 'possible'],
  mfirst: [0, 30, 'possible'],
  msecond: [30, 60, 'possible'],
  unknown: [0, 60, 'unknown'],
};

/** The windows of one Kyiv day, from its 24 hourly slots. */
export function dayWindows(
  date: LocalDate,
  slots: DaySlots,
  source: WindowSource,
  timeZone = KYIV,
): OutageWindow[] {
  const windows: OutageWindow[] = [];
  slots.forEach((status, hour) => {
    const piece = PIECES[status];
    if (!piece) return;
    const [from, to, windowStatus] = piece;
    const start = wallToUtc(date, hour * 60 + from, timeZone);
    const end = wallToUtc(date, hour * 60 + to, timeZone);
    if (end > start) {
      windows.push({
        start: new Date(start),
        end: new Date(end),
        status: windowStatus,
        source,
      });
    }
  });
  return mergeWindows(windows);
}

/**
 * Windows in time order, with those that touch or overlap joined when their
 * status and source match.
 */
export function mergeWindows(windows: OutageWindow[]): OutageWindow[] {
  const sorted = [...windows].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const merged: OutageWindow[] = [];
  for (const w of sorted) {
    const last = merged.findLast(
      (m) => m.status === w.status && m.source === w.source,
    );
    if (last && w.start <= last.end) {
      if (w.end > last.end) last.end = w.end;
    } else {
      merged.push({ ...w });
    }
  }
  return merged.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * The weekly pattern (weekday 1 = Monday … 7 = Sunday) laid over [from, to),
 * with windows cut at the range's ends.
 */
export function weeklyWindows(
  week: Record<number, DaySlots>,
  from: Date,
  to: Date,
  timeZone = KYIV,
): OutageWindow[] {
  if (to <= from) return [];
  const windows: OutageWindow[] = [];
  const last = localDateOf(to, timeZone);
  for (
    let date = localDateOf(from, timeZone);
    !after(date, last);
    date = nextDay(date)
  ) {
    const slots = week[weekday(date)];
    if (slots) windows.push(...dayWindows(date, slots, 'weekly', timeZone));
  }
  return mergeWindows(windows)
    .map((w) => ({
      ...w,
      start: w.start < from ? from : w.start,
      end: w.end > to ? to : w.end,
    }))
    .filter((w) => w.end > w.start);
}

/**
 * The confirmed schedule of the given groups (a house can be on several), and
 * the Kyiv days it covers: a day counts only if one of the groups is published
 * for it.
 */
export function confirmedWindows(
  days: ConfirmedSchedule['days'],
  groups: string[],
  timeZone = KYIV,
): { windows: OutageWindow[]; coveredDays: LocalDate[] } {
  const windows: OutageWindow[] = [];
  const coveredDays: LocalDate[] = [];
  const stamps = Object.keys(days)
    .map(Number)
    .sort((a, b) => a - b);
  for (const stamp of stamps) {
    const date = localDateOf(new Date(stamp * 1000), timeZone);
    const published = groups.filter((g) => days[stamp][g]);
    if (published.length === 0) continue;
    coveredDays.push(date);
    for (const group of published) {
      windows.push(
        ...dayWindows(date, days[stamp][group], 'confirmed', timeZone),
      );
    }
  }
  return { windows: mergeWindows(windows), coveredDays };
}

// --- Kyiv wall clock <-> UTC -------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall clock time at `utcMs`, written as if it were UTC (ms). */
function wallClock(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
}

export function localDateOf(at: Date, timeZone = KYIV): LocalDate {
  const wall = new Date(wallClock(at.getTime(), timeZone));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
  };
}

/**
 * The first instant at which the clock shows `minute` (may be 1440) of
 * `date`. In the hour skipped when clocks go forward, the moment of the jump.
 */
function wallToUtc(date: LocalDate, minute: number, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minute);
  const HALF_DAY = 12 * 3600_000;
  // The offsets in force half a day either side cover any single transition.
  const offsets = [wall - HALF_DAY, wall + HALF_DAY].map(
    (t) => wallClock(t, timeZone) - t,
  );
  const candidates = offsets
    .map((offset) => wall - offset)
    .filter((t) => wallClock(t, timeZone) === wall)
    .sort((a, b) => a - b);
  return candidates.length > 0 ? candidates[0] : wall - offsets[0];
}

function weekday(date: LocalDate): number {
  const sundayZero = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  return sundayZero === 0 ? 7 : sundayZero;
}

function nextDay(date: LocalDate): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function after(a: LocalDate, b: LocalDate): boolean {
  return (
    Date.UTC(a.year, a.month - 1, a.day) > Date.UTC(b.year, b.month - 1, b.day)
  );
}
