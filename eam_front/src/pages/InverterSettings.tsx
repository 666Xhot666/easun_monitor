import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RefreshCw, Send } from 'lucide-react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { formatRegisterValue } from '../inverter/format';
import type { RegisterDefinition } from '../inverter/types';
import { useRegisters } from '../inverter/useRegisters';
import {
  collectChanges,
  groupIntoSections,
  toFormValues,
  type FormValues,
} from '../settings/settingsForm';

/** GET/PATCH /api/inverter/:profileId/settings response. */
interface SettingsSnapshot {
  values: Record<string, number>;
  readAt: string;
}

type LoadState = 'loading' | 'ready' | 'error';
type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving'; names: string[] }
  | { kind: 'saved' }
  | { kind: 'failed'; message: string };

/**
 * The inverter's settings, generated from the server's Register map and
 * read from the inverter itself. Changes are validated here, written by the
 * server, and shown as the inverter confirms them on read-back.
 */
export default function InverterSettings() {
  const { profileId } = useParams<{ profileId: string }>();
  const registers = useRegisters();

  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [form, setForm] = useState<FormValues>({});
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  const original = useMemo(
    () => (registers && snapshot ? toFormValues(registers, snapshot.values) : {}),
    [registers, snapshot],
  );
  const { changes, errors } = useMemo(
    () => (registers ? collectChanges(registers, original, form) : { changes: {}, errors: {} }),
    [registers, original, form],
  );
  const changeCount = Object.keys(changes).length;
  const hasErrors = Object.keys(errors).length > 0;

  function applySnapshot(next: SettingsSnapshot) {
    setSnapshot(next);
    if (registers) setForm(toFormValues(registers, next.values));
  }

  useEffect(() => {
    if (!registers) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await axios.get<SettingsSnapshot>(`/api/inverter/${profileId}/settings`);
        if (cancelled) return;
        setSnapshot(data);
        setForm(toFormValues(registers, data.values));
        setLoadState('ready');
      } catch (error) {
        if (cancelled) return;
        setLoadError(extractErrorMessage(error, "Couldn't read the settings from the inverter."));
        setLoadState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, registers]);

  async function refresh() {
    setRefreshing(true);
    setSaveState({ kind: 'idle' });
    try {
      const { data } = await axios.post<SettingsSnapshot>(`/api/inverter/${profileId}/settings/refresh`);
      applySnapshot(data);
      setLoadState('ready');
    } catch (error) {
      setSaveState({
        kind: 'failed',
        message: extractErrorMessage(error, "Couldn't read the settings from the inverter."),
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function save() {
    if (!registers || changeCount === 0 || hasErrors) return;
    const summary = Object.entries(changes)
      .map(([name, value]) => {
        const definition = registers.find((d) => d.name === name)!;
        return `${definition.label}: ${formatRegisterValue(definition, value)}`;
      })
      .join('\n');
    if (!window.confirm(`Write these settings to the inverter?\n\n${summary}`)) return;

    setSaveState({ kind: 'saving', names: Object.keys(changes) });
    try {
      const { data } = await axios.patch<SettingsSnapshot>(`/api/inverter/${profileId}/settings`, {
        changes,
      });
      applySnapshot(data);
      setSaveState({ kind: 'saved' });
    } catch (error) {
      setSaveState({
        kind: 'failed',
        message: extractErrorMessage(error, "Couldn't write the settings to the inverter."),
      });
    }
  }

  const saving = saveState.kind === 'saving';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              to={`/dashboard/${profileId}`}
              className="text-xs text-gray-500 hover:underline dark:text-gray-400"
            >
              ← Dashboard
            </Link>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Inverter settings</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing || saving || !registers}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh from inverter
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={changeCount === 0 || hasErrors || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {saving ? 'Saving…' : changeCount === 1 ? 'Save 1 change' : `Save ${changeCount} changes`}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {snapshot && (
          <p role="status" className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Read from the inverter {new Date(snapshot.readAt).toLocaleString()}.
          </p>
        )}
        {saveState.kind === 'saved' && (
          <p className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">
            Saved. The inverter confirmed the new values.
          </p>
        )}
        {saveState.kind === 'failed' && (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300"
          >
            {saveState.message}
          </p>
        )}

        {loadState === 'loading' && (
          <p className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
            Reading settings from the inverter…
          </p>
        )}
        {loadState === 'error' && (
          <p role="alert" className="py-16 text-center text-sm text-red-600 dark:text-red-400">
            {loadError}
          </p>
        )}

        {loadState === 'ready' && registers && (
          <div className="space-y-8">
            {groupIntoSections(registers).map((section) => (
              <section key={section.title}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {section.title}
                </h2>
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
                  {section.registers.map((definition) => (
                    <SettingRow
                      key={definition.name}
                      definition={definition}
                      value={form[definition.name] ?? ''}
                      current={snapshot?.values[definition.name]}
                      changed={definition.name in changes}
                      error={errors[definition.name]}
                      disabled={saving}
                      onChange={(text) => setForm((f) => ({ ...f, [definition.name]: text }))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function SettingRow({
  definition,
  value,
  current,
  changed,
  error,
  disabled,
  onChange,
}: {
  definition: RegisterDefinition;
  value: string;
  current: number | undefined;
  changed: boolean;
  error?: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const id = `setting-${definition.name}`;
  const inputClass =
    'w-56 rounded-lg border px-3 py-1.5 text-sm dark:bg-gray-950 dark:text-gray-100 ' +
    (error
      ? 'border-red-400 dark:border-red-600'
      : changed
        ? 'border-blue-400 dark:border-blue-500'
        : 'border-gray-300 dark:border-gray-700');

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <label htmlFor={id} className="text-sm font-medium text-gray-800 dark:text-gray-200">
        {definition.label}
      </label>
      <div className="flex flex-col items-end">
        {!definition.writable ? (
          <span id={id} className="text-sm text-gray-600 dark:text-gray-300">
            {formatRegisterValue(definition, current)}
          </span>
        ) : definition.options ? (
          <select
            id={id}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          >
            {value === '' && <option value="">No data</option>}
            {definition.options.map((option, index) => (
              <option key={option} value={String(index)}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-2">
            <input
              id={id}
              type="number"
              inputMode="decimal"
              step={definition.scale ?? 1}
              min={definition.min}
              max={definition.max}
              value={value}
              placeholder="No data"
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              className={inputClass}
            />
            {definition.unit && (
              <span className="w-8 text-sm text-gray-500 dark:text-gray-400">{definition.unit}</span>
            )}
          </div>
        )}
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
