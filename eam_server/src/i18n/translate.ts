/**
 * The server's texts in the app's languages: alerts, Telegram, files. The
 * catalogs are JSON, one per language; a missing text falls back to
 * English, then to its key.
 */
import { LOCALES, type Language } from './languages';
import en from './locales/en.json';
import uk from './locales/uk.json';

type Catalog = { [key: string]: string | Catalog };

const CATALOGS: Record<Language, Catalog> = { en, uk };

function lookup(catalog: Catalog, key: string): string | undefined {
  let at: string | Catalog | undefined = catalog;
  for (const part of key.split('.')) {
    if (typeof at !== 'object') return undefined;
    at = at[part];
  }
  return typeof at === 'string' ? at : undefined;
}

/** `key`'s plural form for `count` ("_one", "_few", ...), if the catalog has one. */
function plural(
  language: Language,
  key: string,
  count: number,
): string | undefined {
  const form = new Intl.PluralRules(LOCALES[language]).select(count);
  return lookup(CATALOGS[language], `${key}_${form}`);
}

/** The text of `key` in `language`, with each {{name}} filled from `values`. */
export function translate(
  language: Language,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const text =
    (typeof values.count === 'number' && plural(language, key, values.count)) ||
    (lookup(CATALOGS[language], key) ?? lookup(CATALOGS.en, key) ?? key);
  return text.replace(/\{\{(\w+)\}\}/g, (all, name: string) =>
    name in values ? String(values[name]) : all,
  );
}

/** A length of time in whole minutes (at least 1), with hours from an hour on. */
export function duration(ms: number, language: Language): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const t = (key: string, count: number) =>
    translate(language, `units.${key}`, { count });
  if (hours === 0) return t('minutes', rest);
  return rest === 0
    ? t('hours', hours)
    : `${t('hours', hours)} ${t('minutes', rest)}`;
}
