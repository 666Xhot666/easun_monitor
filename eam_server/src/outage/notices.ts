import {
  localDateOf,
  localMinuteOf,
  nextDay,
  type LocalDate,
} from '../outage-reader/dnem/windows';
import { LOCALES, type Language } from '../i18n/languages';
import { translate } from '../i18n/translate';
import type { AlertMessage } from '../alerts/alert-message';

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
  language: Language,
): string | null {
  if (changes.length === 0) return null;
  const t = (k: string, values?: Record<string, string>) =>
    translate(language, `outage.${k}`, values);
  const today = localDateOf(now, timeZone);
  const names = new Map([
    [key(today), t('today')],
    [key(nextDay(today)), t('tomorrow')],
  ]);
  const dayName = (d: LocalDate) => names.get(key(d)) ?? plainDay(d, language);
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
      ? `${dayName(date)} (${plainDay(date, language)})`
      : plainDay(date, language);
    const empty = !events.some(
      (e) => key(localDateOf(e.start, timeZone)) === c.day,
    );
    lines.push(t(empty ? 'publishedEmpty' : 'published', { day: label }));
  }

  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  for (const e of sorted) {
    const what =
      e.kind === 'REPAIR'
        ? e.description
          ? t('repairAbout', { description: e.description })
          : t('repair')
        : t(`what.${e.status}`);
    const when = range(e.start, e.end);
    if (e.type === 'new') {
      lines.push(t(e.kind === 'REPAIR' ? 'newRepair' : 'new', { when, what }));
    } else if (e.type === 'revised') {
      const before = range(e.before.start, e.before.end);
      const after = times(e.start, e.end);
      lines.push(t('revised', { before, after, what }));
    } else {
      lines.push(t('cancelled', { when, what }));
    }
  }
  return [t('updated'), ...lines].join('\n');
}

/** "Tue 13 Oct". */
function plainDay(d: LocalDate, language: Language): string {
  return new Intl.DateTimeFormat(LOCALES[language], {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(d.year, d.month - 1, d.day)));
}

/** One check's changes as an alert, worded when shown (see alert-message.ts). */
export function scheduleUpdateMessage(
  changes: ScheduleChange[],
  now: Date,
): AlertMessage | null {
  if (changes.length === 0) return null;
  return {
    key: 'scheduleUpdated',
    params: {
      changes: JSON.parse(JSON.stringify(changes)),
      madeAt: now.toISOString(),
    },
  };
}

interface StoredSpan {
  start: string;
  end: string;
}

/** The changes of a stored "scheduleUpdated" alert, with their dates back. */
export function changesOf(params: Record<string, unknown>): ScheduleChange[] {
  const dated = (v: StoredSpan) => ({
    start: new Date(v.start),
    end: new Date(v.end),
  });
  const stored = params.changes as Array<
    { type: string; before?: StoredSpan } & Partial<StoredSpan>
  >;
  return stored.map((c) =>
    c.type === 'published'
      ? c
      : {
          ...c,
          ...dated(c as StoredSpan),
          ...(c.before && { before: dated(c.before) }),
        },
  ) as ScheduleChange[];
}
