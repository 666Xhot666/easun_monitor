import type { ForecastWindow } from './forecast';

/** A household member's "Outage soon" choices. */
export interface Member {
  userId: number;
  leadMinutes: number;
  /** Also before possible outages and the weekly pattern. */
  possible: boolean;
}

/** Whether `window` is an outage `member` wants to be reminded of. */
function wanted(window: ForecastWindow, member: Member): boolean {
  if (window.status === 'unknown') return false;
  const confirmed = window.source !== 'weekly' && window.status === 'off';
  return confirmed || member.possible;
}

/**
 * The reminders due at `now`: outages not started yet whose start is within
 * each member's lead time. Which were already sent is up to the caller.
 */
export function remindersDue(
  windows: ForecastWindow[],
  members: Member[],
  now: Date,
): Array<{ window: ForecastWindow; userId: number }> {
  const due = [];
  for (const window of windows) {
    const untilStart = window.start.getTime() - now.getTime();
    if (untilStart <= 0) continue;
    for (const member of members) {
      if (untilStart <= member.leadMinutes * 60_000 && wanted(window, member)) {
        due.push({ window, userId: member.userId });
      }
    }
  }
  return due;
}

/** "Outage in 15 min: 18:00–20:00", with what is known around it. */
export function reminderText(
  window: ForecastWindow,
  now: Date,
  context: { soc: number | null; staleHours: number | null },
  timeZone: string,
): string {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const minutes = Math.max(
    1,
    Math.round((window.start.getTime() - now.getTime()) / 60_000),
  );
  const sure = window.source !== 'weekly' && window.status === 'off';
  let text = `${sure ? 'Outage' : 'Possible outage'} in ${minutes} min: ${clock.format(window.start)}–${clock.format(window.end)}`;
  if (window.source === 'repair') {
    text += `, repair on the house${window.description ? `: ${window.description}` : ''}`;
  }
  if (window.source === 'weekly') text += ' (weekly pattern, not confirmed)';
  if (context.soc !== null) text += `\nBattery ${Math.round(context.soc)} %`;
  if (context.staleHours !== null) {
    text += `\nThe schedule was last checked ${context.staleHours} h ago`;
  }
  return text;
}
