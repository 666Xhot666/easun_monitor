import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { currentLanguage } from '../i18n';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { ageText } from '../shell/age';
import { Button } from '../ui';

interface Limits {
  heatC: number;
  storageFreePercent: number;
  memoryUsedPercent: number;
}

/** GET /api/server/alerts. */
interface Notices {
  limits: Limits;
  events: Array<{ id: number; kind: string; text: string; at: string }>;
}

const FIELDS: { key: keyof Limits; min: number; max: number }[] = [
  { key: 'heatC', min: 40, max: 110 },
  { key: 'storageFreePercent', min: 1, max: 50 },
  { key: 'memoryUsedPercent', min: 50, max: 99 },
];

/** The server notices: the owner's limits, and those sent lately. */
export default function NoticesPanel({ owner, now }: { owner: boolean; now: number }) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const [notices, setNotices] = useState<Notices | null>(null);
  const [draft, setDraft] = useState<Record<keyof Limits, string> | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<Notices>('/api/server/alerts', { params: { lang: language } })
      .then(({ data }) => {
        if (cancelled) return;
        setNotices(data);
        setDraft({
          heatC: String(data.limits.heatC),
          storageFreePercent: String(data.limits.storageFreePercent),
          memoryUsedPercent: String(data.limits.memoryUsedPercent),
        });
      })
      .catch((e) => {
        if (!cancelled) setError(extractErrorMessage(e, i18n.t('server.notices.loadFailed')));
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const save = async () => {
    if (!draft || !notices) return;
    setError('');
    setSaved(false);
    try {
      const { data } = await axios.put<Limits>('/api/server/alerts/limits', {
        heatC: Number(draft.heatC),
        storageFreePercent: Number(draft.storageFreePercent),
        memoryUsedPercent: Number(draft.memoryUsedPercent),
      });
      setNotices({ ...notices, limits: data });
      setSaved(true);
    } catch (e) {
      setError(extractErrorMessage(e, t('server.notices.saveFailed')));
    }
  };

  if (!notices || !draft) {
    return error ? (
      <p role="alert" className="mt-4 text-sm text-crit-ink">
        {error}
      </p>
    ) : null;
  }
  const { limits, events } = notices;

  return (
    <section aria-label={t('server.notices.title')} className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="text-[15px] font-semibold">{t('server.notices.title')}</h2>
      {owner ? (
        <div className="mt-3 space-y-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex items-center gap-3 text-sm">
              <label htmlFor={`limit-${f.key}`} className="w-52">
                {t(`server.notices.${f.key}`)}
              </label>
              <input
                id={`limit-${f.key}`}
                type="number"
                min={f.min}
                max={f.max}
                value={draft[f.key]}
                onChange={(e) => {
                  setSaved(false);
                  setDraft({ ...draft, [f.key]: e.target.value });
                }}
                className="h-9 w-20 rounded-lg border border-line-strong bg-surface px-2 text-right text-sm text-ink"
              />
            </div>
          ))}
          {error && (
            <p role="alert" className="rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button size="sm" variant="primary" onClick={() => void save()}>
              {t('server.notices.save')}
            </Button>
            {saved && <span className="text-sm text-muted">{t('server.notices.saved')}</span>}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {t('server.notices.summary', { heat: limits.heatC, storage: limits.storageFreePercent, memory: limits.memoryUsedPercent })}
        </p>
      )}
      <h3 className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">{t('server.notices.recent')}</h3>
      {events.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t('server.notices.none')}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 py-1.5">
              <span>{e.text}</span>
              <span className="flex-none text-xs text-muted">{t('server.notices.ago', { age: ageText(now - Date.parse(e.at)) })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
