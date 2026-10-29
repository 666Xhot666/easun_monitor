import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { browserLanguage, isLanguage } from './detect';
import { DEFAULT_LANGUAGE, LOCALES, STORAGE_KEY, type Language } from '@eam/shared/languages';
import en from '@eam/shared/i18n/en.json';
import uk from '@eam/shared/i18n/uk.json';

function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

const initial = storedLanguage() ?? browserLanguage(typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]);

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, uk: { translation: uk } },
  lng: initial,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
  returnNull: false,
});
document.documentElement.lang = initial;

/** Switches the app to `language` and remembers it in this browser. */
export function applyLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private mode: the switch still works until the page is closed.
  }
  document.documentElement.lang = language;
  void i18n.changeLanguage(language);
}

/** The current language. */
export const currentLanguage = (): Language => (isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE);

/** Locale for formatting dates and numbers in the current language. */
export const currentLocale = (): string => LOCALES[currentLanguage()];

export default i18n;
