const pad = (value: number): string => String(value).padStart(2, '0');

/** "2026-10-05 21:17:03+02:00 [serial-logger] message": local time with its
 * UTC offset, so a line can be matched against the dashboard from any zone. */
export function formatLogLine(message: string, at: Date = new Date()): string {
  const offsetMinutes = -at.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  return `${date} ${time}${offset} [serial-logger] ${message}`;
}
