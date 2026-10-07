/** What an alert is about; the Alerts page filters and colours by it. */
export type AlertKind = 'fault' | 'warning' | 'grid' | 'battery' | 'connection';

const PREFIXES: [prefix: string, kind: AlertKind][] = [
  ['Fault', 'fault'],
  ['Grid', 'grid'],
  ['Battery low', 'battery'],
  ['Logger', 'connection'],
  ['BMS reader', 'connection'],
];

/** The kind of an alert message as worded in telegram/alerts.ts and telegram-alerts.ts. */
export function alertKind(message: string): AlertKind {
  return (
    PREFIXES.find(([prefix]) => message.startsWith(prefix))?.[1] ?? 'warning'
  );
}
