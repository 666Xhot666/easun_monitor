import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import axios from '../lib/apiClient';
import { Segmented } from '../ui';
import { applyLanguage } from '.';
import { isLanguage } from './detect';
import { LANGUAGE_NAMES, LANGUAGES, type Language } from '@eam/shared/languages';

const OPTIONS = LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] }));

/** English or Ukrainian: kept in this browser, and on the account when signed in. */
export default function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const change = (language: Language) => {
    applyLanguage(language);
    if (auth.user) {
      // The app switches at once; the account keeps it for next time and for Telegram.
      void axios
        .put('/api/auth/language', { language })
        .then(() => auth.refreshUser())
        .catch(() => {});
    }
  };
  return <Segmented ariaLabel={t('language.label')} size="sm" options={OPTIONS} value={isLanguage(i18n.language) ? i18n.language : 'en'} onChange={change} />;
}
