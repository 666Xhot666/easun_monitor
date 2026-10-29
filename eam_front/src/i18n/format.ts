import type { Locale } from 'date-fns';
import { enGB, uk } from 'date-fns/locale';
import { formatter, type Unit } from '@eam/shared/format';
import enTexts from '@eam/shared/i18n/en.json';
import ukTexts from '@eam/shared/i18n/uk.json';
import type { Language } from '@eam/shared/languages';
import { currentLanguage, currentLocale } from '.';

export type { Unit };

/** Unit names per language, from the shared texts. */
const UNITS: Record<Language, Partial<Record<Unit, string>>> = { en: enTexts.units, uk: ukTexts.units };

/** The shared formatter for the current language. */
const current = () => formatter(currentLocale(), UNITS[currentLanguage()]);

/** The unit as written in the current language. */
export const unit = (u: Unit): string => current().unit(u);

/** A number in the current language's way: 1,234.5 or 1 234,5. */
export const num = (value: number, decimals = 0): string => current().num(value, decimals);

/** "2.84 kW", "620 W": a number with its unit. */
export const withUnit = (value: number, u: Unit, decimals = 0): string => current().withUnit(value, u, decimals);

/** A clock time in the current language: "14:05". */
export const clock = (at: Date | number | string): string =>
  new Date(at).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** date-fns locale for the current language: Ukrainian month and day names, or British English. */
export const dateLocale = (): Locale => (currentLanguage() === 'uk' ? uk : enGB);

/** A measured value as is (2700, 21.7), with only the decimal separator of the current language. */
export const plain = (value: number): string => current().plain(value);

/** "2700 W", "21.7 A": a measured value with its unit, without thousands separators. */
export const plainUnit = (value: number, u: Unit): string => current().plainUnit(value, u);

/** "2.84 kW" from 1000 W up, "620 W" below, "--" when unknown. */
export const power = (watts: number | undefined): string => current().power(watts);
