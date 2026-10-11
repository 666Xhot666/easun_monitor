/**
 * The settings rules worded in a language: their texts are in
 * src/i18n/locales under "settingsRules", keyed by each rule's `key`. Kept
 * apart from the rules, which stay import-free for the simulator.
 */
import type { Language } from '../../i18n/languages';
import { translate } from '../../i18n/translate';
import type { Bounds, SettingsConstraints } from './settings-rules';

/** `constraints` with the rule texts and the battery context in `language`. */
export function wordConstraints(
  constraints: SettingsConstraints,
  language: Language,
): SettingsConstraints {
  const t = (key: string, values?: Record<string, string | number>) =>
    translate(language, `settingsRules.${key}`, values);
  const voltage = constraints.batteryVoltage;
  const bounds = Object.fromEntries(
    Object.entries(constraints.bounds).map(([name, b]) => [
      name,
      b.context && voltage !== null
        ? { ...b, context: t('forBattery', { voltage }) }
        : b,
    ]),
  );
  const rules = constraints.rules.map((rule) =>
    rule.kind === 'inactive'
      ? { ...rule, reason: t(rule.key) }
      : { ...rule, message: t(rule.key) },
  );
  return { ...constraints, bounds, rules };
}

/** The out-of-range message in `language`, for `checkSettings`. */
export const outOfBoundsIn =
  (language: Language) =>
  (bounds: Bounds): string =>
    translate(language, 'settingsRules.between', {
      min: bounds.min ?? '-∞',
      max: bounds.max ?? '∞',
      context: bounds.context ? ` ${bounds.context}` : '',
    });
