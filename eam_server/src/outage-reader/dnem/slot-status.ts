/**
 * The site's status for one hourly slot. `first`/`second` mean the first or
 * second 30 minutes of the hour; the `m` forms and `maybe` are possible
 * outages, `no`/`first`/`second` confirmed ones. Anything else the site sends
 * is `unknown`, never an error.
 */
export type SlotStatus =
  | 'yes'
  | 'no'
  | 'maybe'
  | 'first'
  | 'second'
  | 'mfirst'
  | 'msecond'
  | 'unknown';

const KNOWN = new Set<string>([
  'yes',
  'no',
  'maybe',
  'first',
  'second',
  'mfirst',
  'msecond',
]);

export function toSlotStatus(raw: string): SlotStatus {
  return KNOWN.has(raw) ? (raw as SlotStatus) : 'unknown';
}
