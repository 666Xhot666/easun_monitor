import en from './locales/en.json';
import uk from './locales/uk.json';
import { duration, translate } from './translate';

describe('translate', () => {
  it('fills in values and falls back to English, then to the key', () => {
    expect(translate('en', 'alerts.batteryLow', { soc: 18 })).toBe(
      'Battery low: 18 %',
    );
    expect(translate('uk', 'alerts.batteryLow', { soc: 18 })).toBe(
      'Низький заряд акумулятора: 18 %',
    );
    expect(translate('uk', 'no.such.key')).toBe('no.such.key');
  });

  it('says how long in the language', () => {
    expect(duration(7_800_000, 'en')).toBe('2 h 10 min');
    expect(duration(7_800_000, 'uk')).toBe('2 год 10 хв');
    expect(duration(3_600_000, 'uk')).toBe('1 год');
    expect(duration(10_000, 'en')).toBe('1 min');
  });
});

describe('catalogs', () => {
  type Tree = { [key: string]: string | Tree };
  const keys = (tree: Tree, prefix = ''): string[] =>
    Object.entries(tree).flatMap(([k, v]) =>
      typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`),
    );

  it('have the same texts in English and Ukrainian', () => {
    expect(keys(uk).sort()).toEqual(keys(en).sort());
  });
});
