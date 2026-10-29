import { describe, expect, it } from 'vitest';
import en from './i18n/en.json';
import uk from './i18n/uk.json';
import { formatter } from './format';

describe('formatter', () => {
  it('writes numbers and units the English way', () => {
    const f = formatter('en-GB', en.units);
    expect(f.num(1234.5, 1)).toBe('1,234.5');
    expect(f.withUnit(2.5, 'kW', 1)).toBe('2.5 kW');
    expect(f.plainUnit(2700, 'W')).toBe('2700 W');
    expect(f.plain(21.7)).toBe('21.7');
  });

  it('writes them the Ukrainian way, with Ukrainian unit names', () => {
    const f = formatter('uk-UA', uk.units);
    expect(f.num(1234.5, 1)).toBe('1 234,5');
    expect(f.withUnit(2.5, 'kW', 1)).toBe('2,5 кВт');
    expect(f.plainUnit(21.7, 'A')).toBe('21,7 А');
  });

  it('writes power in W below 1 kW and kW above, dashes when unknown', () => {
    const f = formatter('en-GB', en.units);
    expect(f.power(620.4)).toBe('620 W');
    expect(f.power(-2840)).toBe('2.84 kW');
    expect(f.power(undefined)).toBe('--');
    expect(f.power(Number.NaN)).toBe('--');
  });

  it('writes a unit it has no name for as is', () => {
    expect(formatter('en-GB', {}).withUnit(3, 'rpm')).toBe('3 rpm');
  });
});
