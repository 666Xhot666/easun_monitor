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

  it('picks the plural form of the language for a count', () => {
    expect(
      translate('en', 'alerts.serverSecurityUpdates', {
        count: 1,
        packages: 4,
      }),
    ).toBe('Server: 1 security update available (4 updates in all)');
    expect(
      translate('en', 'alerts.serverSecurityUpdates', {
        count: 3,
        packages: 4,
      }),
    ).toBe('Server: 3 security updates available (4 updates in all)');
    expect(
      translate('uk', 'alerts.serverSecurityUpdates', {
        count: 3,
        packages: 4,
      }),
    ).toBe('Сервер: доступно 3 оновлення безпеки (усього оновлень: 4)');
    expect(
      translate('uk', 'alerts.serverSecurityUpdates', {
        count: 5,
        packages: 9,
      }),
    ).toBe('Сервер: доступно 5 оновлень безпеки (усього оновлень: 9)');
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

  it('have the same texts in English and Ukrainian, plural forms aside', () => {
    const unique = (tree: Tree) => [
      ...new Set(
        keys(tree).map((k) => k.replace(/_(zero|one|two|few|many|other)$/, '')),
      ),
    ];
    expect(unique(uk).sort()).toEqual(unique(en).sort());
  });
});
