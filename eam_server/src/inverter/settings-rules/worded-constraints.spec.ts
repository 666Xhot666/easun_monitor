import { checkSettings } from './settings-rules';
import { settingsConstraints } from './smg-ii.settings-rules';
import { outOfBoundsIn, wordConstraints } from './worded-constraints';

const LITHIUM_24V = { batteryNominalVoltage: 24, batteryType: 'LIFEPO4' };

describe('wordConstraints', () => {
  const constraints = settingsConstraints(LITHIUM_24V);

  it('words every rule in English exactly as the rules have it', () => {
    expect(wordConstraints(constraints, 'en')).toEqual(constraints);
  });

  it('words every rule, and the battery context, in Ukrainian', () => {
    const uk = wordConstraints(constraints, 'uk');
    uk.rules.forEach((rule, i) => {
      const en = constraints.rules[i];
      const text = rule.kind === 'inactive' ? rule.reason : rule.message;
      const english = en.kind === 'inactive' ? en.reason : en.message;
      expect({ key: rule.key, same: text === english }).toEqual({
        key: rule.key,
        same: false,
      });
    });
    expect(uk.bounds.MaxChargingVoltage.context).toBe('для акумулятора 24 В');
  });

  it('says a value is out of range in the language', () => {
    const uk = wordConstraints(constraints, 'uk');
    const check = checkSettings(
      uk,
      {},
      { MaxChargingVoltage: 99 },
      outOfBoundsIn('uk'),
    );
    expect(check.errors.MaxChargingVoltage[0]).toMatch(
      /^Має бути від \d+(\.\d+)? до \d+(\.\d+)? для акумулятора 24 В$/,
    );
    expect(
      checkSettings(constraints, {}, { MaxChargingVoltage: 99 }).errors
        .MaxChargingVoltage[0],
    ).toMatch(/^Must be between .* for a 24 V battery$/);
  });
});
