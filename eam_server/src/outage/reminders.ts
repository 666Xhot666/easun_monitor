import type { Language } from '../i18n/languages';
import { translate } from '../i18n/translate';
import type { AlertMessage } from '../alerts/alert-message';
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
  language: Language,
): string {
  const t = (key: string, values?: Record<string, string | number>) =>
    translate(language, `outage.${key}`, values);
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
  let text = t(sure ? 'soon' : 'possibleSoon', {
    minutes,
    from: clock.format(window.start),
    to: clock.format(window.end),
  });
  if (window.source === 'repair') {
    text += `, ${window.description ? t('repairAbout', { description: window.description }) : t('repair')}`;
  }
  if (window.source === 'weekly') text += t('weekly');
  if (context.soc !== null) {
    text += `\n${t('battery', { soc: Math.round(context.soc) })}`;
  }
  if (context.staleHours !== null) {
    text += `\n${t('stale', { hours: context.staleHours })}`;
  }
  return text;
}

/** A reminder as an alert, worded when shown (see alert-message.ts). */
export function reminderMessage(
  window: ForecastWindow,
  now: Date,
  context: { soc: number | null; staleHours: number | null },
): AlertMessage {
  return {
    key: 'outageSoon',
    params: {
      window: JSON.parse(JSON.stringify(window)),
      madeAt: now.toISOString(),
      ...context,
    },
  };
}

/** The window of a stored "outageSoon" alert, with its dates back. */
export function windowOf(params: Record<string, unknown>): ForecastWindow {
  const w = params.window as ForecastWindow & { start: string; end: string };
  return { ...w, start: new Date(w.start), end: new Date(w.end) };
}
