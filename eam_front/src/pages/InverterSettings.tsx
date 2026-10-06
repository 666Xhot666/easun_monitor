import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Info, RefreshCw, Send } from 'lucide-react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { decimalsFor, formatRegisterValue } from '../inverter/format';
import type { PanelSetting, RegisterDefinition } from '../inverter/types';
import { useRegisters } from '../inverter/useRegisters';
import {
  collectChanges,
  groupIntoSections,
  toFormValues,
  type FormValues,
} from '../settings/settingsForm';
import LithiumSetupHelper from '../settings/LithiumSetupHelper';
import { checkSettings, NO_CONSTRAINTS, type Bounds, type SettingsConstraints } from '../settings/settingsRules';

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
  const [constraints, setConstraints] = useState<SettingsConstraints>(NO_CONSTRAINTS);
  const [panelSettings, setPanelSettings] = useState<PanelSetting[]>([]);

  const original = useMemo(
    () => (registers && snapshot ? toFormValues(registers, snapshot.values) : {}),
    [registers, snapshot],
  );
  const { changes, errors } = useMemo(
    () => (registers ? collectChanges(registers, original, form) : { changes: {}, errors: {} }),
    [registers, original, form],
  );
  const check = useMemo(
    () => checkSettings(constraints, snapshot?.values ?? {}, changes),
    [constraints, snapshot, changes],
  );
  const fieldErrors = useMemo(() => {
    const merged: Record<string, string[]> = { ...check.errors };
    for (const [name, message] of Object.entries(errors)) merged[name] = [message, ...(merged[name] ?? [])];
    return merged;
  }, [check, errors]);
  const changeCount = Object.keys(changes).length;
  const hasErrors = Object.keys(fieldErrors).length > 0;

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

  // The rules come from the profile, not the inverter, so they load even
  // while the inverter is unreachable; without them only per-register
  // checks apply.
  useEffect(() => {
    let cancelled = false;
    axios
      .get<SettingsConstraints>(`/api/inverter/${profileId}/settings/constraints`)
      .then(({ data }) => {
        if (!cancelled) setConstraints(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<PanelSetting[]>('/api/inverter/panel-settings')
      .then(({ data }) => {
        if (!cancelled) setPanelSettings(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Puts proposed values into the form as unsaved edits. */
  function propose(settings: Record<string, number>) {
    if (!registers) return;
    setForm((current) => {
      const next = { ...current };
      for (const [name, value] of Object.entries(settings)) {
        const definition = registers.find((d) => d.name === name && d.writable);
        if (definition) next[name] = value.toFixed(decimalsFor(definition));
      }
      return next;
    });
  }

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
    for (const name of Object.keys(changes)) {
      const definition = registers.find((d) => d.name === name)!;
      if (definition.risk && !window.confirm(`${definition.label}: ${definition.risk}\n\nChange it anyway?`)) return;
    }
    const summary = Object.entries(changes)
      .map(([name, value]) => {
        const definition = registers.find((d) => d.name === name)!;
        return `${definition.label}: ${formatRegisterValue(definition, value)}`;
      })
      .join('\n');
    const warnings = [...new Set(Object.values(check.warnings).flat())];
    const caution = warnings.length
      ? `\n\nPlease confirm you want this despite:\n${warnings.map((w) => `- ${w}`).join('\n')}`
      : '';
    if (!window.confirm(`Write these settings to the inverter?\n\n${summary}${caution}`)) return;

    setSaveState({ kind: 'saving', names: Object.keys(changes) });
    try {
      const { data } = await axios.patch<SettingsSnapshot>(`/api/inverter/${profileId}/settings`, {
        changes,
        ...(warnings.length ? { acknowledgeWarnings: true } : {}),
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
            <LithiumSetupHelper onPropose={propose} />
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
                      errors={fieldErrors[definition.name]}
                      warnings={check.warnings[definition.name]}
                      inactive={check.inactive[definition.name]}
                      bounds={constraints.bounds[definition.name]}
                      panelPrograms={panelSettings
                        .filter((p) => p.affects?.includes(definition.name))
                        .map((p) => p.program)}
                      defaultValue={constraints.defaults[definition.name] ?? definition.default}
                      disabled={saving}
                      onChange={(text) => setForm((f) => ({ ...f, [definition.name]: text }))}
                    />
                  ))}
                </div>
              </section>
            ))}
            {panelSettings.length > 0 && <PanelSettings settings={panelSettings} />}
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
  errors,
  warnings,
  inactive,
  bounds,
  panelPrograms,
  defaultValue,
  disabled,
  onChange,
}: {
  definition: RegisterDefinition;
  value: string;
  current: number | undefined;
  changed: boolean;
  errors?: string[];
  warnings?: string[];
  /** Why the setting currently has no effect. */
  inactive?: string;
  bounds?: Bounds;
  /** Panel-only programs this setting's effect depends on. */
  panelPrograms: string[];
  defaultValue?: number;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const id = `setting-${definition.name}`;
  const inputClass =
    'w-56 rounded-lg border px-3 py-1.5 text-sm dark:bg-gray-950 dark:text-gray-100 ' +
    (errors
      ? 'border-red-400 dark:border-red-600'
      : changed
        ? 'border-blue-400 dark:border-blue-500'
        : 'border-gray-300 dark:border-gray-700');

  const [open, setOpen] = useState(false);
  const facts = [
    definition.panelProgram && `Program ${definition.panelProgram}`,
    defaultValue !== undefined && `Default: ${formatRegisterValue(definition, defaultValue)}`,
  ].filter((fact): fact is string => Boolean(fact));
  const explained = definition.description || definition.optionDescriptions;

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${inactive ? 'opacity-60' : ''}`}>
      <div>
        <div className="flex items-center gap-1.5">
          <label htmlFor={id} className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {definition.label}
          </label>
          {explained && (
            <button
              type="button"
              aria-label={`About ${definition.label}`}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <Info className="h-4 w-4" />
            </button>
          )}
        </div>
        {inactive && <p className="mt-0.5 text-xs italic text-gray-500 dark:text-gray-400">{inactive}</p>}
        {facts.length > 0 && (
          <p className="mt-0.5 flex gap-2 text-xs text-gray-500 dark:text-gray-400">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </p>
        )}
        {panelPrograms.map((program) => (
          <a
            key={program}
            href={`#panel-${program}`}
            className="mr-2 text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            Depends on panel program {program}
          </a>
        ))}
      </div>
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
        ) : definition.choices ? (
          <select
            id={id}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          >
            {value === '' && <option value="">No data</option>}
            {current !== undefined && !definition.choices.includes(current) && (
              <option value={current.toFixed(decimalsFor(definition))}>
                {formatRegisterValue(definition, current)} (not a panel option)
              </option>
            )}
            {definition.choices.map((choice) => (
              <option key={choice} value={choice.toFixed(decimalsFor(definition))}>
                {definition.unit ? `${choice} ${definition.unit}` : choice}
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
              min={bounds?.min ?? definition.min}
              max={bounds?.max ?? definition.max}
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
        {bounds && (bounds.min !== undefined || bounds.max !== undefined) && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatRange(definition, bounds)}</p>
        )}
        {warnings?.map((message) => (
          <p key={message} className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {message}
          </p>
        ))}
        {errors?.map((message) => (
          <p key={message} className="mt-1 text-xs text-red-600 dark:text-red-400">
            {message}
          </p>
        ))}
      </div>
      {open && explained && (
        <div className="basis-full rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
          {definition.description && <p>{definition.description}</p>}
          {definition.options && definition.optionDescriptions && (
            <dl className="mt-1.5 space-y-1">
              {definition.options.map((option, index) => (
                <div key={option}>
                  <dt className="inline font-medium">{option}: </dt>
                  <dd className="inline">{definition.optionDescriptions![index]}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

/** Settings with no register: shown for reference, set on the inverter. */
function PanelSettings({ settings }: { settings: PanelSetting[] }) {
  return (
    <section aria-labelledby="panel-settings-title">
      <h2
        id="panel-settings-title"
        className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
      >
        Set on the inverter's panel
      </h2>
      <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
        The app can't read or change these; they still change how the settings above behave.
      </p>
      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
        {settings.map((setting) => (
          <div key={`${setting.program}-${setting.title}`} id={`panel-${setting.program}`} className="px-4 py-3">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{setting.title}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Program {setting.program} · Default: {setting.default}
            </p>
            {setting.options && (
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{setting.options.join(', ')}</p>
            )}
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{setting.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** {min: 24, max: 30} -> "24.0–30.0 V", at the register's resolution. */
function formatRange(definition: RegisterDefinition, bounds: Bounds): string {
  const decimals = decimalsFor(definition);
  const format = (value: number | undefined) => (value === undefined ? '…' : value.toFixed(decimals));
  const unit = definition.unit ? ` ${definition.unit}` : '';
  return `${format(bounds.min)}–${format(bounds.max)}${unit}`;
}
