import { useEffect, useState } from 'react';
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

const FIELDS: { key: keyof Limits; label: string; min: number; max: number }[] = [
  { key: 'heatC', label: 'Overheating at (°C)', min: 40, max: 110 },
  { key: 'storageFreePercent', label: 'Storage low under (% free)', min: 1, max: 50 },
  { key: 'memoryUsedPercent', label: 'Memory short at (% used)', min: 50, max: 99 },
];

/** The server notices: the owner's limits, and those sent lately. */
export default function NoticesPanel({ owner, now }: { owner: boolean; now: number }) {
  const [notices, setNotices] = useState<Notices | null>(null);
  const [draft, setDraft] = useState<Record<keyof Limits, string> | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<Notices>('/api/server/alerts')
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
        if (!cancelled) setError(extractErrorMessage(e, 'Couldn’t load the notices.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setError(extractErrorMessage(e, 'Couldn’t save the limits.'));
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
    <section aria-label="Notices" className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="text-[15px] font-semibold">Notices</h2>
      {owner ? (
        <div className="mt-3 space-y-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex items-center gap-3 text-sm">
              <label htmlFor={`limit-${f.key}`} className="w-52">
                {f.label}
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
              Save limits
            </Button>
            {saved && <span className="text-sm text-muted">Saved.</span>}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">
          Overheating at {limits.heatC} °C · storage low under {limits.storageFreePercent} % free · memory short at {limits.memoryUsedPercent} % used
        </p>
      )}
      <h3 className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">Recent</h3>
      {events.length === 0 ? (
        <p className="mt-1 text-sm text-muted">None yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 py-1.5">
              <span>{e.text}</span>
              <span className="flex-none text-xs text-muted">{ageText(now - Date.parse(e.at))} ago</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
