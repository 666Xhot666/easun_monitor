import { describe, expect, it } from 'vitest';
import { browserLanguage } from './detect';
import en from './locales/en.json';
import uk from './locales/uk.json';

/** Every key, with plural suffixes folded into the base key. */
function keys(catalog: object, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') for (const k of keys(value, path)) out.add(k);
    else out.add(path.replace(/_(zero|one|two|few|many|other)$/, ''));
  }
  return out;
}

describe('languages', () => {
  it("follows the browser: Ukrainian if it asks for it, English otherwise, never Russian", () => {
    expect(browserLanguage(['uk-UA', 'en'])).toBe('uk');
    expect(browserLanguage(['de-DE', 'uk'])).toBe('uk');
    expect(browserLanguage(['en-US'])).toBe('en');
    expect(browserLanguage(['ru-RU', 'ru'])).toBe('en');
    expect(browserLanguage([])).toBe('en');
  });

  it('has every text in both languages', () => {
    const missingInUk = [...keys(en)].filter((k) => !keys(uk).has(k));
    const missingInEn = [...keys(uk)].filter((k) => !keys(en).has(k));
    expect({ missingInUk, missingInEn }).toEqual({ missingInUk: [], missingInEn: [] });
  });

  it('has the Ukrainian plural forms wherever English has a plural', () => {
    const flat = (catalog: object, prefix = ''): string[] =>
      Object.entries(catalog).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, prefix ? `${prefix}.${k}` : k) : [prefix ? `${prefix}.${k}` : k]));
    const plurals = flat(en).filter((k) => k.endsWith('_other')).map((k) => k.slice(0, -'_other'.length));
    for (const base of plurals) {
      for (const form of ['one', 'few', 'many', 'other']) {
        expect(flat(uk)).toContain(`${base}_${form}`);
      }
    }
  });
});
