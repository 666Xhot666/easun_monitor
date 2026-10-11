/**
 * An alert as a message key with its values, so it can be worded in each
 * reader's language when shown (Alerts page) or sent (Telegram). The
 * texts are in i18n/locales under "alerts".
 */
import type { Language } from '../i18n/languages';
import { duration, translate } from '../i18n/translate';
import { registerMapFor } from '../inverter/registers/register-translations';
import { clockTime } from '../telegram/messages';
import type { AlertKind } from './alert-kind';

export interface AlertMessage {
  key: string;
  params?: Record<string, string | number>;
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
};

/** What an alert is about, by its key. */
export function alertKindOf(key: string): AlertKind {
  return KINDS[key] ?? 'warning';
}

/** One value as worded in `language`: by its name's role. */
function word(
  name: string,
  value: string | number,
  language: Language,
  timeZone: string,
): string | number {
  if (name === 'fault')
    return registerMapFor(language).flagName('FaultCode', Number(value));
  if (name === 'warning')
    return registerMapFor(language).flagName('WarningCode', Number(value));
  if (name.endsWith('Ms')) return duration(Number(value), language);
  if (name.endsWith('At')) return clockTime(new Date(value), timeZone);
  return value;
}

/** The alert in `language`, with clock times in `timeZone`. */
export function alertText(
  message: AlertMessage,
  language: Language,
  timeZone: string,
): string {
  const values = Object.fromEntries(
    Object.entries(message.params ?? {}).map(([name, value]) => [
      name,
      word(name, value, language, timeZone),
    ]),
  );
  return translate(language, `alerts.${message.key}`, values);
}
