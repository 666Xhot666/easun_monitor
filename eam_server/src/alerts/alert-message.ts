/**
 * An alert as a message key with its values, so it can be worded in each
 * reader's language when shown (Alerts page) or sent (Telegram). The
 * texts are in i18n/locales under "alerts".
 */
import { LOCALES, type Language } from '../i18n/languages';
import { duration, translate } from '../i18n/translate';
import { registerMapFor } from '../inverter/registers/register-translations';
import { bmsAlarmName } from '../telegram/cards';
import { clockTime } from '../telegram/messages';
import type { AlertKind } from './alert-kind';
import { SITE_TIME_ZONE } from '../outage-reader/dnem/windows';
import { changesOf, scheduleUpdateText } from '../outage/notices';
import { reminderText, windowOf } from '../outage/reminders';

export interface AlertMessage {
  key: string;
  /** JSON values; see `word` for how each is worded. */
  params?: Record<string, unknown>;
}

const KINDS: Record<string, AlertKind> = {
  fault: 'fault',
  faultsCleared: 'fault',
  warning: 'warning',
  gridLost: 'grid',
  gridRestored: 'grid',
  batteryLow: 'battery',
  bmsAlarm: 'warning',
  bmsAlarmsCleared: 'warning',
  loggerDown: 'connection',
  loggerBack: 'connection',
  bmsSilent: 'connection',
  bmsBack: 'connection',
  scheduleUpdated: 'schedule',
  outageSoon: 'outage',
  scheduleUnavailable: 'schedule-unavailable',
  scheduleBack: 'schedule-unavailable',
};

/** Alerts worded as a whole from their values; outage times are in the site's zone. */
const COMPOSED: Record<
  string,
  (params: Record<string, unknown>, language: Language) => string
> = {
  scheduleUpdated: (p, language) =>
    scheduleUpdateText(
      changesOf(p),
      new Date(p.madeAt as string),
      SITE_TIME_ZONE,
      language,
    ) ?? '',
  outageSoon: (p, language) =>
    reminderText(
      windowOf(p),
      new Date(p.madeAt as string),
      {
        soc: p.soc as number | null,
        staleHours: p.staleHours as number | null,
      },
      SITE_TIME_ZONE,
      language,
    ),
};

/** What an alert is about, by its key. */
export function alertKindOf(key: string): AlertKind {
  return KINDS[key] ?? 'warning';
}

/** One value as worded in `language`: by its name's role. */
function word(
  name: string,
  value: unknown,
  language: Language,
  timeZone: string,
): string | number {
  if (name === 'fault')
    return registerMapFor(language).flagName('FaultCode', Number(value));
  if (name === 'warning')
    return registerMapFor(language).flagName('WarningCode', Number(value));
  if (name === 'alarm') return bmsAlarmName(String(value), language);
  if (name.endsWith('Ms')) return duration(Number(value), language);
  if (name.endsWith('At')) return clockTime(new Date(String(value)), timeZone);
  if (name === 'reason')
    return translate(language, `outage.reasons.${String(value)}`);
  if (typeof value !== 'number') return String(value);
  // Whole numbers stay numbers: a count picks its plural form.
  return Number.isInteger(value)
    ? value
    : new Intl.NumberFormat(LOCALES[language], {
        maximumFractionDigits: 1,
        useGrouping: false,
      }).format(value);
}

/** The alert in `language`, with clock times in `timeZone`. */
export function alertText(
  message: AlertMessage,
  language: Language,
  timeZone: string,
): string {
  const composed = COMPOSED[message.key];
  if (composed) return composed(message.params ?? {}, language);
  const values = Object.fromEntries(
    Object.entries(message.params ?? {}).map(([name, value]) => [
      name,
      word(name, value, language, timeZone),
    ]),
  );
  return translate(language, `alerts.${message.key}`, values);
}
