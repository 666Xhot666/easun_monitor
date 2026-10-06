const LINE_END = '\r\n';

/** Quotes a cell when it holds a comma, quote or line break. */
const cell = (text: string): string =>
  /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/** One CSV line, CRLF-terminated. */
export const csvLine = (cells: string[]): string =>
  cells.map(cell).join(',') + LINE_END;

/**
 * Wall-clock time in `timeZone` as "2026-10-05 21:17:34" (sv-SE formats
 * that way). Throws a RangeError for an unknown time zone.
 */
export function wallClock(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}
