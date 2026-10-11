import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../lib/apiClient';
import type { Language } from '../i18n/languages';
import { currentLanguage } from '../i18n';
import type { RegisterDefinition } from './types';

// The register map only changes with a server release, so it is fetched
// once per page load and language and shared by every screen.
const cached = new Map<Language, Promise<RegisterDefinition[]>>();

function loadRegisters(lang: Language): Promise<RegisterDefinition[]> {
  let found = cached.get(lang);
  if (!found) {
    found = axios
      .get<RegisterDefinition[]>('/api/inverter/registers', { params: { lang } })
      .then(({ data }) => data)
      .catch((error: unknown) => {
        cached.delete(lang);
        throw error;
      });
    cached.set(lang, found);
  }
  return found;
}

/** The server's Register map in the current language; null until loaded (or if loading failed). */
export function useRegisters(): RegisterDefinition[] | null {
  useTranslation(); // renders again when the language changes
  const lang = currentLanguage();
  const [registers, setRegisters] = useState<RegisterDefinition[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadRegisters(lang)
      .then((data) => {
        if (!cancelled) setRegisters(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lang]);
  return registers;
}
