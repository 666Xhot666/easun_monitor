/** The languages the app speaks. Never Russian. */
export const LANGUAGES = ['en', 'uk'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

/** Each language's name in itself, for the switch. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  uk: 'Українська',
};

/** Locale for dates and numbers. */
export const LOCALES: Record<Language, string> = {
  en: 'en-GB',
  uk: 'uk-UA',
};

/** This browser's choice, before signing in (the account keeps it after). */
export const STORAGE_KEY = 'eam.language';
