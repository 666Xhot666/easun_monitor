import {
  SITE_TIME_ZONE,
  localDateOf,
  localMinuteOf,
  nextDay,
  wallToUtc,
} from './dnem/windows';

export interface Cadence {
  intervalMinutes: number;
  /** Shorter interval in the evening, when the next day's schedule is usually published. */
  eveningIntervalMinutes: number;
  /** The evening, in minutes since local midnight: [from, to). */
  evening: { from: number; to: number };
  /** The pause after the site turned even the browser away. */
  blockedHours: number;
}

const MINUTE = 60_000;

/**
 * When to check next after a check at `from`: the evening interval inside the
 * evening, otherwise the normal one, but never past the start of the next
 * evening. After a block, a long pause instead.
 */
export function nextCheckAt(
  from: Date,
  cadence: Cadence,
  last: { blocked: boolean },
  timeZone = SITE_TIME_ZONE,
): Date {
  if (last.blocked) {
    return new Date(from.getTime() + cadence.blockedHours * 60 * MINUTE);
  }
  const minute = localMinuteOf(from, timeZone);
  const { evening } = cadence;
  if (minute >= evening.from && minute < evening.to) {
    return new Date(from.getTime() + cadence.eveningIntervalMinutes * MINUTE);
  }
  const normal = from.getTime() + cadence.intervalMinutes * MINUTE;
  const today = localDateOf(from, timeZone);
  const eveningDay = minute < evening.from ? today : nextDay(today);
  const eveningStart = wallToUtc(eveningDay, evening.from, timeZone);
  return new Date(Math.min(normal, eveningStart));
}
