/**
 * The newest alert id this browser has shown on the Alerts page, per
 * inverter: the bell counts what is newer. Kept in this browser only.
 */
const key = (profileId: number) => `eam.alerts.seen.${profileId}`;
export const SEEN_EVENT = 'eam-alerts-seen';

export function lastSeenAlert(profileId: number): number {
  try {
    return Number(localStorage.getItem(key(profileId))) || 0;
  } catch {
    return 0;
  }
}

export function markAlertsSeen(profileId: number, newestId: number): void {
  if (newestId <= lastSeenAlert(profileId)) return;
  try {
    localStorage.setItem(key(profileId), String(newestId));
  } catch {
    // Storage blocked: the bell keeps its count until the next visit.
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}
