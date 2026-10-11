/** What an alert is about; the Alerts page filters and colours by it. */
export type AlertKind =
  | 'fault'
  | 'warning'
  | 'grid'
  | 'battery'
  | 'connection'
  /** The outage schedule changed. */
  | 'schedule'
  /** An outage is about to start. */
  | 'outage'
  /** The outage schedule could not be checked for a long time, or is back. */
  | 'schedule-unavailable';

const PREFIXES: [prefix: string, kind: AlertKind][] = [
  ['Fault', 'fault'],
  ['Grid', 'grid'],
  ['Battery low', 'battery'],
  ['Logger', 'connection'],
  ['BMS reader', 'connection'],
  // Longest first: these share their start.
  ['Outage schedule unavailable', 'schedule-unavailable'],
  ['Outage schedule back', 'schedule-unavailable'],
  ['Outage schedule', 'schedule'],
  ['Outage in', 'outage'],
  ['Possible outage in', 'outage'],
];

/** The kind of an alert message as worded in telegram/alerts.ts, telegram-alerts.ts and the outage notices. */
export function alertKind(message: string): AlertKind {
  return (
    PREFIXES.find(([prefix]) => message.startsWith(prefix))?.[1] ?? 'warning'
  );
}
