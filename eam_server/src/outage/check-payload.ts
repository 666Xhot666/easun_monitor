import { BadRequestException } from '@nestjs/common';
import type { SlotStatus } from '../outage-reader/dnem/slot-status';
import type { PostOutageCheckDto } from './dto/post-outage-check.dto';

/**
 * The nested parts of a successful check, checked strictly: they are written
 * to the database and later read as the schedule, so anything off is
 * refused rather than stored.
 */

export type DaySlots = SlotStatus[];

export interface HouseOutage {
  description: string;
  type: string;
  start: Date;
  end: Date;
}

export type HouseResult =
  | { found: false }
  | { found: true; groups: string[]; outage: HouseOutage | null };

export interface OkCheck {
  house: HouseResult;
  /** Group → weekday "1" (Monday) .. "7" → slots. */
  weekly: Record<string, Record<string, DaySlots>>;
  confirmed: {
    /** The site's "updated" stamp, in site time. */
    updated: string;
    /** local day "YYYY-MM-DD" → group → slots. */
    days: Record<string, Record<string, DaySlots>>;
  };
}

const STATUSES = new Set<string>([
  'yes',
  'no',
  'maybe',
  'first',
  'second',
  'mfirst',
  'msecond',
  'unknown',
]);
const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'];

export function parseOkCheck(dto: PostOutageCheckDto): OkCheck {
  const weekly = record(dto.weekly, 'weekly');
  const confirmed = record(dto.confirmed, 'confirmed');
  if (typeof confirmed.updated !== 'string') {
    throw invalid('confirmed.updated must be text');
  }
  return {
    house: parseHouse(dto.house),
    weekly: mapValues(weekly, (days, group) => {
      const byDay = record(days, `weekly.${group}`);
      const keys = Object.keys(byDay).sort();
      if (keys.join() !== WEEKDAYS.join()) {
        throw invalid(`weekly.${group} must have the weekdays 1 to 7`);
      }
      return mapValues(byDay, (slots, d) =>
        daySlots(slots, `weekly.${group}.${d}`),
      );
    }),
    confirmed: {
      updated: confirmed.updated,
      days: mapValues(
        record(confirmed.days, 'confirmed.days'),
        (groups, day) => {
          if (!isDay(day)) throw invalid(`confirmed.days.${day} is not a date`);
          return mapValues(
            record(groups, `confirmed.days.${day}`),
            (slots, group) => daySlots(slots, `confirmed.days.${day}.${group}`),
          );
        },
      ),
    },
  };
}

function parseHouse(raw: unknown): HouseResult {
  const house = record(raw, 'house');
  if (house.found === false) return { found: false };
  if (house.found !== true) throw invalid('house.found must be true or false');
  const groups = house.groups;
  if (!Array.isArray(groups) || !groups.every((g) => typeof g === 'string')) {
    throw invalid('house.groups must be a list of group names');
  }
  return { found: true, groups, outage: parseOutage(house.outage) };
}

function parseOutage(raw: unknown): HouseOutage | null {
  if (raw === null) return null;
  const outage = record(raw, 'house.outage');
  const start = instant(outage.start, 'house.outage.start');
  const end = instant(outage.end, 'house.outage.end');
  if (end <= start) throw invalid('house.outage must end after it starts');
  if (
    typeof outage.description !== 'string' ||
    typeof outage.type !== 'string'
  ) {
    throw invalid('house.outage needs a description and type');
  }
  return { description: outage.description, type: outage.type, start, end };
}

function daySlots(raw: unknown, what: string): DaySlots {
  if (
    !Array.isArray(raw) ||
    raw.length !== 24 ||
    !raw.every((s) => typeof s === 'string' && STATUSES.has(s))
  ) {
    throw invalid(`${what} must be 24 slot statuses`);
  }
  return raw as DaySlots;
}

function instant(raw: unknown, what: string): Date {
  const date = typeof raw === 'string' ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime()))
    throw invalid(`${what} is not a time`);
  return date;
}

function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

function record(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalid(`${what} is required`);
  }
  return raw as Record<string, unknown>;
}

function mapValues<T>(
  from: Record<string, unknown>,
  map: (value: unknown, key: string) => T,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(from).map(([k, v]) => [k, map(v, k)]),
  );
}

function invalid(message: string): BadRequestException {
  return new BadRequestException(message);
}
