import { SiteError } from './site-error';
import { toSlotStatus, type SlotStatus } from './slot-status';

/**
 * Parses the grid operator's schedule page (/ua/shutdowns). Besides the AJAX
 * address and CSRF token in its meta tags, the page carries its data inline as
 * `DisconSchedule.<name> = <JSON>` assignments: every city's streets, the
 * weekly pattern of each outage group, and the confirmed schedule.
 *
 * Validation is strict: anything off the expected shape is a `shape` error, so
 * a changed site is reported as such instead of being read as "no outages".
 */

/** 24 statuses, index 0 = 00:00–01:00 site time. */
export type DaySlots = SlotStatus[];

export interface WeeklyPattern {
  /** Group id → the site's name for it, e.g. GPV5.2 → "Черга 5.2". */
  groupNames: Record<string, string>;
  /** Group id → weekday (1 = Monday … 7 = Sunday) → slots. */
  groups: Record<string, Record<number, DaySlots>>;
}

export interface ConfirmedSchedule {
  /** Unix time of today's local midnight, as the site sees it. */
  today: number;
  /** The site's "updated" stamp, in site time, e.g. "10.10.2026 20:40". */
  updated: string;
  /** Day (Unix time of its local midnight) → group id → slots. */
  days: Record<number, Record<string, DaySlots>>;
}

export interface SchedulePage {
  ajaxUrl: string;
  csrfToken: string;
  /** City → its streets, in the site's spelling. */
  streets: Record<string, string[]>;
  weekly: WeeklyPattern;
  confirmed: ConfirmedSchedule;
}

const FALLBACK_AJAX_PATH = '/ua/ajax';
const SLOTS_PER_DAY = 24;
const CHALLENGE_MARKERS =
  /_Incapsula_Resource|Request unsuccessful|incident_id/i;

export function parseSchedulePage(html: string, pageUrl: string): SchedulePage {
  if (!html.includes('DisconSchedule.') && CHALLENGE_MARKERS.test(html)) {
    throw new SiteError(
      'challenge',
      'The site answered with a firewall challenge',
    );
  }
  const csrfToken = metaContent(html, 'csrf-token');
  if (!csrfToken) throw shape('No csrf-token meta tag');
  const ajaxPath = metaContent(html, 'ajaxUrl') || FALLBACK_AJAX_PATH;

  return {
    ajaxUrl: new URL(ajaxPath, pageUrl).toString(),
    csrfToken,
    streets: parseStreets(assigned(html, 'streets')),
    weekly: parseWeekly(assigned(html, 'preset')),
    confirmed: parseConfirmed(assigned(html, 'fact')),
  };
}

function shape(message: string): SiteError {
  return new SiteError('shape', message);
}

function metaContent(html: string, name: string): string | null {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attr = (key: string) =>
      new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1];
    if (attr('name') === name) return decodeEntities(attr('content') ?? '');
  }
  return null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** The JSON value assigned to `DisconSchedule.<name>`, parsed. */
function assigned(html: string, name: string): unknown {
  const match = new RegExp(`DisconSchedule\\.${name}\\s*=\\s*`).exec(html);
  if (!match) throw shape(`DisconSchedule.${name} is missing`);
  const start = match.index + match[0].length;
  const end = endOfJsonValue(html, start);
  if (end === null)
    throw shape(`DisconSchedule.${name} is not a JSON object or array`);
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    throw shape(`DisconSchedule.${name} is not valid JSON`);
  }
}

/**
 * Index just past the object or array starting at `start`, found by matching
 * brackets outside strings; null when no object or array starts there.
 */
function endOfJsonValue(text: string, start: number): number | null {
  if (text[start] !== '{' && text[start] !== '[') return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{' || c === '[') {
      depth++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw shape(`${what} is not an object`);
  return value;
}

function parseStreets(raw: unknown): Record<string, string[]> {
  const streets: Record<string, string[]> = {};
  for (const [city, list] of Object.entries(record(raw, 'streets'))) {
    if (!Array.isArray(list) || !list.every((s) => typeof s === 'string')) {
      throw shape(`Streets of ${city} are not a list of names`);
    }
    streets[city] = list;
  }
  return streets;
}

/** Slots keyed "1".."24" → 24 statuses; anything else is a shape error. */
function daySlots(raw: unknown, what: string): DaySlots {
  const byKey = record(raw, what);
  const slots: DaySlots = [];
  for (let n = 1; n <= SLOTS_PER_DAY; n++) {
    const value = byKey[String(n)];
    if (typeof value !== 'string')
      throw shape(`${what} has no status for slot ${n}`);
    slots.push(toSlotStatus(value));
  }
  return slots;
}

/** The slots must be the 24 hours of the day, in order; the windows rely on it. */
function checkHourlySlots(raw: unknown): void {
  const zones = record(raw, 'preset.time_zone');
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  for (let n = 1; n <= SLOTS_PER_DAY; n++) {
    const zone = zones[String(n)];
    const from = Array.isArray(zone) ? zone[1] : undefined;
    const to = Array.isArray(zone) ? zone[2] : undefined;
    const lastTo = n === SLOTS_PER_DAY && (to === '24:00' || to === '00:00');
    if (from !== hh(n - 1) || (to !== hh(n) && !lastTo)) {
      throw shape(
        `preset.time_zone slot ${n} is not ${hh(n - 1)}–${hh(n % 24)}`,
      );
    }
  }
}

function parseWeekly(raw: unknown): WeeklyPattern {
  const preset = record(raw, 'preset');
  checkHourlySlots(preset.time_zone);

  const groupNames: Record<string, string> = {};
  for (const [id, name] of Object.entries(
    record(preset.sch_names, 'preset.sch_names'),
  )) {
    if (typeof name !== 'string')
      throw shape(`preset.sch_names.${id} is not text`);
    groupNames[id] = name;
  }

  const groups: Record<string, Record<number, DaySlots>> = {};
  for (const [id, days] of Object.entries(record(preset.data, 'preset.data'))) {
    const byDay = record(days, `preset.data.${id}`);
    groups[id] = {};
    for (let day = 1; day <= 7; day++) {
      groups[id][day] = daySlots(
        byDay[String(day)],
        `preset.data.${id} day ${day}`,
      );
    }
  }
  return { groupNames, groups };
}

function parseConfirmed(raw: unknown): ConfirmedSchedule {
  const fact = record(raw, 'fact');
  if (typeof fact.today !== 'number' || !Number.isInteger(fact.today)) {
    throw shape('fact.today is not a timestamp');
  }
  if (typeof fact.update !== 'string') throw shape('fact.update is not text');

  // An empty schedule comes as [] (PHP's empty array).
  const data =
    Array.isArray(fact.data) && fact.data.length === 0 ? {} : fact.data;
  const days: ConfirmedSchedule['days'] = {};
  for (const [stamp, groups] of Object.entries(record(data, 'fact.data'))) {
    if (!/^\d+$/.test(stamp))
      throw shape(`fact.data day ${stamp} is not a timestamp`);
    const byGroup: Record<string, DaySlots> = {};
    for (const [id, slots] of Object.entries(
      record(groups, `fact.data.${stamp}`),
    )) {
      byGroup[id] = daySlots(slots, `fact.data.${stamp}.${id}`);
    }
    days[Number(stamp)] = byGroup;
  }
  return { today: fact.today, updated: fact.update, days };
}
