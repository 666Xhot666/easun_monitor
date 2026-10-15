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
