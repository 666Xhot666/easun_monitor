import type { Locale } from 'date-fns';
import { enGB, uk } from 'date-fns/locale';
import i18n, { currentLanguage, currentLocale } from '.';

/** Units with a name per language (кВт, В, Гц…); %, °C and the like are the same everywhere. */
export type Unit = 'W' | 'kW' | 'kWh' | 'Wh' | 'V' | 'mV' | 'A' | 'Ah' | 'Hz' | 'VA' | 'h' | 'm' | 's' | 'rpm';

/** The unit as written in the current language. */
export const unit = (u: Unit): string => i18n.t(`units.${u}`);

/** A number in the current language's way: 1,234.5 or 1 234,5. */
export function num(value: number, decimals = 0): string {
  return new Intl.NumberFormat(currentLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** "2.84 kW", "620 W": a number with its unit. */
export const withUnit = (value: number, u: Unit, decimals = 0): string => `${num(value, decimals)} ${unit(u)}`;

/** A clock time in the current language: "14:05". */
export const clock = (at: Date | number | string): string =>
  new Date(at).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** date-fns locale for the current language: Ukrainian month and day names, or British English. */
export const dateLocale = (): Locale => (currentLanguage() === 'uk' ? uk : enGB);
