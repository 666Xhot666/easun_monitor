/** The languages the app speaks. Never Russian. */
export const LANGUAGES = ['en', 'uk'] as const;

export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

/** `value` when it names a language the app speaks, else the default. */
export function languageOr(value: unknown): Language {
  return LANGUAGES.find((l) => l === value) ?? DEFAULT_LANGUAGE;
}
