import type { StreetReading } from './dnem/read-street';
import type { DaySlots } from './dnem/schedule-page';
import { localDateOf } from './dnem/windows';

/** The body of POST /api/outage/reader/checks for a successful check. */
export interface CheckPayload {
  checkedAt: string;
  outcome: 'ok';
  usedBrowser: boolean;
  house:
    | { found: false }
    | {
        found: true;
        groups: string[];
        outage: {
          description: string;
          type: string;
          start: string;
          end: string;
        } | null;
      };
  weekly: Record<string, Record<string, DaySlots>>;
  confirmed: {
    updated: string;
    days: Record<string, Record<string, DaySlots>>;
  };
}

/**
 * What one reading of the street means for the configured house: its groups
 * and current outage, and the weekly pattern and confirmed days of those
 * groups only.
 */
export function buildCheck(
  reading: StreetReading,
  house: string,
  checkedAt: Date,
): CheckPayload {
  const { page } = reading;
  const key = Object.keys(reading.houses).find((h) => sameHouse(h, house));
  const info = key === undefined ? null : reading.houses[key];
  const groups = info?.groups ?? [];

  const weekly: CheckPayload['weekly'] = {};
  for (const group of groups) {
    const days = page.weekly.groups[group];
    if (!days) continue;
    weekly[group] = Object.fromEntries(
      Object.entries(days).map(([d, slots]) => [String(d), slots]),
    );
  }

  const days: CheckPayload['confirmed']['days'] = {};
  for (const [stamp, byGroup] of Object.entries(page.confirmed.days)) {
    const mine = groups.filter((g) => byGroup[g]);
    if (mine.length === 0) continue;
    const { year, month, day } = localDateOf(new Date(Number(stamp) * 1000));
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    days[key] = Object.fromEntries(mine.map((g) => [g, byGroup[g]]));
  }

  return {
    checkedAt: checkedAt.toISOString(),
    outcome: 'ok',
    usedBrowser: reading.usedBrowser,
    house: info
      ? {
          found: true,
          groups,
          outage: info.outage && {
            description: info.outage.description,
            type: info.outage.type,
            start: info.outage.start.toISOString(),
            end: info.outage.end.toISOString(),
          },
        }
      : { found: false },
    weekly,
    confirmed: { updated: page.confirmed.updated, days },
  };
}

/** Latin letters that look like Cyrillic ones, as typed in house numbers. */
const LOOKALIKES: Record<string, string> = {
  a: 'а',
  b: 'в',
  c: 'с',
  e: 'е',
  h: 'н',
  i: 'і',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  t: 'т',
  x: 'х',
};

/** House numbers as a person types them and as the site spells them. */
export function sameHouse(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

function normalize(house: string): string {
  return [...house.toLowerCase().replace(/\s+/g, '')]
    .map((c) => LOOKALIKES[c] ?? c)
    .join('');
}
