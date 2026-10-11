import {
  localDateOf,
  localMinuteOf,
  nextDay,
  type LocalDate,
} from '../outage-reader/dnem/windows';

interface EventFields {
  kind: 'SCHEDULE' | 'REPAIR';
  status: 'OFF' | 'POSSIBLE' | 'UNKNOWN';
  start: Date;
  end: Date;
  description: string | null;
}

/** What one check changed in the address's outages. */
export type ScheduleChange =
  /** The confirmed schedule of a Kyiv day (YYYY-MM-DD) appeared. */
  | { type: 'published'; day: string }
  | ({ type: 'new' } & EventFields)
  | ({ type: 'revised'; before: { start: Date; end: Date } } & EventFields)
  | ({ type: 'withdrawn' } & EventFields);

const WHAT: Record<EventFields['status'], string> = {
  OFF: 'off',
  POSSIBLE: 'possible outage',
  UNKNOWN: 'unclear',
};

const key = (d: LocalDate) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/**
 * The "Outage schedule updated" message for one check's changes, in time
 * order; null when nothing changed.
 */
export function scheduleUpdateText(
  changes: ScheduleChange[],
  now: Date,
  timeZone: string,
): string | null {
  if (changes.length === 0) return null;
  const today = localDateOf(now, timeZone);
  const names = new Map([
    [key(today), 'today'],
    [key(nextDay(today)), 'tomorrow'],
  ]);
  const dayName = (d: LocalDate) => names.get(key(d)) ?? plainDay(d);
  const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
  const clock = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

  /** "21:00–22:30", with the end's day when it is another one (midnight is 24:00). */
  const times = (start: Date, end: Date) => {
    const startDay = localDateOf(start, timeZone);
    const endDay = localDateOf(end, timeZone);
    const endMinute = localMinuteOf(end, timeZone);
    const to =
      key(endDay) === key(startDay)
        ? clock(endMinute)
        : endMinute === 0 && key(endDay) === key(nextDay(startDay))
          ? '24:00'
          : `${dayName(endDay)} ${clock(endMinute)}`;
    return `${clock(localMinuteOf(start, timeZone))}–${to}`;
  };
  const range = (start: Date, end: Date) =>
    `${capital(dayName(localDateOf(start, timeZone)))} ${times(start, end)}`;

  const lines: string[] = [];
  const events = changes.filter((c) => c.type !== 'published');
  for (const c of changes) {
    if (c.type !== 'published') continue;
    const [year, month, day] = c.day.split('-').map(Number);
    const date = { year, month, day };
    const label = names.has(c.day)
      ? `${dayName(date)} (${plainDay(date)})`
      : plainDay(date);
    const empty = !events.some(
      (e) => key(localDateOf(e.start, timeZone)) === c.day,
    );
    lines.push(`Schedule for ${label} published${empty ? ': no outages' : ''}`);
  }

  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  for (const e of sorted) {
    const what =
      e.kind === 'REPAIR'
        ? `repair on the house${e.description ? `: ${e.description}` : ''}`
        : WHAT[e.status];
    if (e.type === 'new') {
      lines.push(
        `${range(e.start, e.end)} ${what}${e.kind === 'REPAIR' ? '' : ' (new)'}`,
      );
    } else if (e.type === 'revised') {
      lines.push(
        `${range(e.before.start, e.before.end)} → ${times(e.start, e.end)} ${what}`,
      );
    } else {
      lines.push(`${range(e.start, e.end)} ${what} cancelled`);
    }
  }
  return ['Outage schedule updated', ...lines].join('\n');
}

/** "Tue 13 Oct". */
function plainDay(d: LocalDate): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(d.year, d.month - 1, d.day)));
}
