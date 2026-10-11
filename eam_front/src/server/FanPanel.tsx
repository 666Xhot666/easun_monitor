import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { Button, Segmented } from '../ui';
import { speedName } from './fanSpeed';

type Mode = 'FIRMWARE' | 'AUTO' | 'MANUAL';

export interface FanSettings {
  mode: Mode;
  minPercent: number;
  manualPercent: number;
  rules: Array<{ aboveC: number; percent: number }>;
}

/** GET /api/server/fan. */
export interface FanStatus {
  settings: FanSettings;
  /** What the agent last did with the fan; null without a fan it controls. */
  state: { mode: 'firmware' | 'manual'; percent: number | null; pwm: number | null; steps: number | null; error: string | null } | null;
}

const MODES: { value: Mode; label: string }[] = [
  { value: 'FIRMWARE', label: 'Firmware' },
  { value: 'AUTO', label: 'Auto' },
  { value: 'MANUAL', label: 'Manual' },
];
const MODE_TEXT: Record<Mode, string> = {
  FIRMWARE: 'The firmware runs the fan.',
  AUTO: 'The agent sets the fan by the temperature.',
  MANUAL: 'The agent holds the fan at one speed.',
};

/** A rule as typed: text until saved. */
interface DraftRule {
  key: number;
  aboveC: string;
  percent: string;
}

let nextKey = 0;
const draftOf = (s: FanSettings) => ({
  mode: s.mode,
  minPercent: String(s.minPercent),
  manualPercent: String(s.manualPercent),
  rules: s.rules.map((r) => ({ key: nextKey++, aboveC: String(r.aboveC), percent: String(r.percent) })),
});
const byTemperature = (rules: DraftRule[]) =>
  [...rules].sort((a, b) => (Number(a.aboveC) || Infinity) - (Number(b.aboveC) || Infinity));

const input = 'h-9 w-20 rounded-lg border border-line-strong bg-surface px-2 text-right text-sm text-ink';

/** The host's fan: what it is doing, and the owner's settings for the agent. */
export default function FanPanel({ owner }: { owner: boolean }) {
  const [status, setStatus] = useState<FanStatus | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof draftOf> | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<FanStatus>('/api/server/fan')
      .then(({ data }) => {
        if (cancelled) return;
        setStatus(data);
        setDraft(draftOf(data.settings));
      })
      .catch((e) => {
        if (!cancelled) setError(extractErrorMessage(e, 'Couldn’t load the fan settings.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || !draft) {
    return error ? (
      <p role="alert" className="text-sm text-crit-ink">
        {error}
      </p>
    ) : null;
  }

  const steps = status.state?.steps ?? null;
  const named = (percent: number) => {
    const name = speedName(percent, steps);
    return name ? ` (${name})` : '';
  };
  const change = (patch: Partial<typeof draft>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };
  const setRule = (key: number, patch: Partial<DraftRule>) =>
    change({ rules: draft.rules.map((r) => (r.key === key ? { ...r, ...patch } : r)) });

  const save = async () => {
    setError('');
    const rules = byTemperature(draft.rules);
    const settings: FanSettings = {
      mode: draft.mode,
      minPercent: Number(draft.minPercent),
      manualPercent: Number(draft.manualPercent),
      rules: rules.map((r) => ({ aboveC: Number(r.aboveC), percent: Number(r.percent) })),
    };
    try {
      const { data } = await axios.put<FanSettings>('/api/server/fan', settings);
      setStatus({ ...status, settings: data });
      setDraft(draftOf(data));
      setSaved(true);
    } catch (e) {
      setError(extractErrorMessage(e, 'Couldn’t save the fan settings.'));
    }
  };

  const { state, settings } = status;
  const now = !state
    ? 'Now: no report from the agent on the fan'
    : state.mode === 'firmware'
      ? 'Now: run by the firmware'
      : `Now: ${state.percent} %${named(state.percent ?? 0)}`;

  return (
    <section aria-label="Fan control" className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="text-[15px] font-semibold">Fan control</h2>
      <p className="mt-1 text-sm">{now}</p>
      {state?.error && (
        <p role="alert" className="mt-2 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-ink">
          The agent could not set the fan: {state.error}
        </p>
      )}

      {!owner ? (
        <div className="mt-3 space-y-1 text-sm text-muted">
          <p>{MODE_TEXT[settings.mode]}</p>
          {settings.mode === 'MANUAL' && <p>Speed {settings.manualPercent} %{named(settings.manualPercent)}</p>}
          {settings.mode === 'AUTO' && (
            <>
              <p>
                Minimum {settings.minPercent} %{named(settings.minPercent)}
              </p>
              {settings.rules.map((r) => (
                <p key={r.aboveC}>
                  Above {r.aboveC} °C: {r.percent} %{named(r.percent)}
                </p>
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <div>
            <Segmented ariaLabel="Fan mode" options={MODES} value={draft.mode} onChange={(mode) => change({ mode })} />
            <p className="mt-1.5 text-xs text-muted">
              {MODE_TEXT[draft.mode]} When the agent stops, the firmware takes the fan back.
            </p>
          </div>

          {draft.mode === 'MANUAL' && (
            <div className="flex items-center gap-3 text-sm">
              <label htmlFor="fan-manualPercent" className="w-40">
                Speed (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                id="fan-manualPercent"
                value={draft.manualPercent}
                onChange={(e) => change({ manualPercent: e.target.value })}
                className={input}
              />
              {speedName(Number(draft.manualPercent), steps) && <span className="text-muted">→ {speedName(Number(draft.manualPercent), steps)}</span>}
            </div>
          )}

          {draft.mode === 'AUTO' && (
            <>
              <div className="flex items-center gap-3 text-sm">
                <label htmlFor="fan-minPercent" className="w-40">
                  Minimum speed (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  id="fan-minPercent"
                value={draft.minPercent}
                  onChange={(e) => change({ minPercent: e.target.value })}
                  className={input}
                />
                {speedName(Number(draft.minPercent), steps) && <span className="text-muted">→ {speedName(Number(draft.minPercent), steps)}</span>}
              </div>
              <table aria-label="Rules" className="text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th scope="col" className="pb-1 pr-3 text-left font-normal">Above (°C)</th>
                    <th scope="col" className="pb-1 pr-3 text-left font-normal">Speed (%)</th>
                    <th scope="col" />
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {draft.rules.map((r) => (
                    <tr key={r.key}>
                      <td className="py-1 pr-3">
                        <input
                          type="number"
                          min={0}
                          max={120}
                          aria-label="Above (°C)"
                          value={r.aboveC}
                          onChange={(e) => setRule(r.key, { aboveC: e.target.value })}
                          onBlur={() => change({ rules: byTemperature(draft.rules) })}
                          className={input}
                        />
                      </td>
                      <td className="py-1 pr-3">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          aria-label="Speed (%)"
                          value={r.percent}
                          onChange={(e) => setRule(r.key, { percent: e.target.value })}
                          className={input}
                        />
                      </td>
                      <td className="py-1 pr-3 text-muted">{speedName(Number(r.percent), steps) ?? ''}</td>
                      <td className="py-1">
                        <button
                          type="button"
                          aria-label={`Remove the rule above ${r.aboveC} °C`}
                          onClick={() => change({ rules: draft.rules.filter((x) => x.key !== r.key) })}
                          className="h-8 rounded-lg px-2 text-[13px] text-crit-ink hover:bg-crit-bg"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button size="sm" onClick={() => change({ rules: [...draft.rules, { key: nextKey++, aboveC: '', percent: '' }] })}>
                Add rule
              </Button>
            </>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={() => void save()}>
              Save
            </Button>
            {saved && <span className="text-sm text-muted">Saved.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
