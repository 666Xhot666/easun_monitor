import { addDays, format, parseISO } from 'date-fns';

/** A local calendar day as "YYYY-MM-DD", the format of <input type="date">. */
export type Day = string;

export const toDay = (date: Date): Day => format(date, 'yyyy-MM-dd');

/** Local midnight starting the day. */
const start = (day: Day): Date => parseISO(day);

/** The day as an ISO range, from its local midnight to the next. */
export const dayRange = (day: Day): { from: string; to: string } => daysRange(day, day);

/** Whole days from `first` to `last`, both included, as an ISO range. */
export const daysRange = (first: Day, last: Day): { from: string; to: string } => ({
  from: start(first).toISOString(),
  to: addDays(start(last), 1).toISOString(),
});

export const shiftDay = (day: Day, days: number): Day => toDay(addDays(start(day), days));

export const dayLabel = (day: Day, today: Day): string => {
  if (day === today) return 'Today';
  if (day === shiftDay(today, -1)) return 'Yesterday';
  return format(start(day), 'EEE, d MMM yyyy');
};
