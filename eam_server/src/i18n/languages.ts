/** The languages the app speaks. Never Russian. */
export const LANGUAGES = ['en', 'uk'] as const;

export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';
