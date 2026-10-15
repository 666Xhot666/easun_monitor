import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './languages';

export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);

/**
 * The first of the browser's languages the app speaks; English otherwise.
 * Russian is not one of them, so a Russian browser gets English.
 */
export function browserLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLanguage(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}
