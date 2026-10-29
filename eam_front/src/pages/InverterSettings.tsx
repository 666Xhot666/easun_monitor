import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { currentLanguage, currentLocale } from '../i18n';
import { useParams } from 'react-router-dom';
import { Check, CircleAlert, Info, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { decimalsFor, formatRegisterValue } from '../inverter/format';
import type { PanelSetting, RegisterDefinition } from '@eam/shared/inverter';
import { useRegisters } from '../inverter/useRegisters';
import {
  collectChanges,
  groupIntoSections,
  toFormValues,
  type FormValues,
} from '../settings/settingsForm';
import LithiumSetupHelper from '../settings/LithiumSetupHelper';
import { useAuth } from '../auth/useAuth';
import { checkSettings, NO_CONSTRAINTS, type Bounds, type SettingsConstraints } from '../settings/settingsRules';
import { Button, Segmented } from '../ui';
import { Dialog } from '../ui/Dialog';

/** GET/PATCH /api/inverter/:profileId/settings response. */
interface SettingsSnapshot {
  values: Record<string, number>;
  readAt: string;
}

type LoadState = 'loading' | 'ready' | 'error';
type Filter = 'all' | 'changed' | 'nondefault';

interface ResultRow {
  name: string;
  label: string;
  program?: string;
  value: string;
  ok: boolean;
  /** "Confirmed" or "Inverter still reports 230 V". */
  note: string;
}

type SaveDialog =
  | { kind: 'review' }
  | { kind: 'writing'; count: number }
  | { kind: 'done'; rows: ResultRow[] }
  | { kind: 'error'; message: string };

const sectionId = (title: string) => `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/**
 * The inverter's settings, generated from the server's Register map and
 * read from the inverter itself. Changes are validated here, reviewed in a
 * dialog, written by the server and shown as the inverter confirms them on
 * read-back.
 */
export default function InverterSettings() {
  const { t } = useTranslation();
  const language = currentLanguage();
  const { profileId } = useParams<{ profileId: string }>();
  const { user } = useAuth();
  // Readers see everything and change nothing, and so does everyone while
  // writes to the inverter are locked; the server enforces the same.
  const thisProfile = user?.inverterProfiles.find((p) => p.id === Number(profileId));
  const writesLocked = thisProfile?.writesLocked === true;
  const readOnly = thisProfile?.role !== 'ADMIN' || writesLocked;
  const registers = useRegisters();

  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [form, setForm] = useState<FormValues>({});
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [dialog, setDialog] = useState<SaveDialog | null>(null);
  const [constraints, setConstraints] = useState<SettingsConstraints>(NO_CONSTRAINTS);
  const [panelSettings, setPanelSettings] = useState<PanelSetting[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

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
  const editedCount = new Set([...Object.keys(changes), ...Object.keys(errors)]).size;
  const hasErrors = Object.keys(fieldErrors).length > 0;
  const definitionOf = (name: string) => registers?.find((d) => d.name === name);
  const defaultOf = (d: RegisterDefinition) => constraints.defaults[d.name] ?? d.default;
  const isNonDefault = (d: RegisterDefinition) => {
    const fallback = defaultOf(d);
    const current = snapshot?.values[d.name];
    return d.writable === true && fallback !== undefined && current !== undefined && Math.abs(current - fallback) > 1e-9;
  };

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
        setLoadError(extractErrorMessage(error, i18n.t('invSettings.readFailed')));
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
    // The rules' texts come in the request's language: asked for again when it changes.
  }, [profileId, language]);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<PanelSetting[]>('/api/inverter/panel-settings', { params: { lang: language } })
      .then(({ data }) => {
        if (!cancelled) setPanelSettings(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Leaving the page (reload, close) with edits not yet written asks first.
  useEffect(() => {
    if (editedCount === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editedCount]);

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
    setRefreshError('');
    try {
      const { data } = await axios.post<SettingsSnapshot>(`/api/inverter/${profileId}/settings/refresh`);
      setSnapshot(data);
      if (registers) setForm(toFormValues(registers, data.values));
      setLoadState('ready');
    } catch (error) {
      setRefreshError(extractErrorMessage(error, i18n.t('invSettings.readFailed')));
    } finally {
      setRefreshing(false);
    }
  }

  const warnings = [...new Set(Object.values(check.warnings).flat())];
  const risks = Object.keys(changes).flatMap((name) => {
    const d = definitionOf(name);
    return d?.risk ? [`${d.label}: ${d.risk}`] : [];
  });

  async function write() {
    if (!registers) return;
    const sent = { ...changes };
    const names = Object.keys(sent);
    setDialog({ kind: 'writing', count: names.length });
    try {
      const { data } = await axios.patch<SettingsSnapshot>(`/api/inverter/${profileId}/settings`, {
        changes: sent,
        ...(warnings.length ? { acknowledgeWarnings: true } : {}),
      });
      const rows: ResultRow[] = names.map((name) => {
        const d = definitionOf(name)!;
        const tolerance = (d.scale ?? 1) / 2;
        const ok = data.values[name] !== undefined && Math.abs(data.values[name] - sent[name]) < tolerance;
        return {
          name,
          label: d.label,
          program: d.panelProgram,
          value: formatRegisterValue(d, sent[name]),
          ok,
          note: ok ? t('invSettings.confirmed') : t('invSettings.stillReports', { value: formatRegisterValue(d, data.values[name]) }),
        };
      });
      // What the inverter confirmed becomes the new baseline; a value that
      // didn't stick stays as an unsaved edit so it can be retried.
      const keep = Object.fromEntries(rows.filter((r) => !r.ok).map((r) => [r.name, form[r.name]]));
      setSnapshot(data);
      setForm({ ...toFormValues(registers, data.values), ...keep });
      setDialog({ kind: 'done', rows });
    } catch (error) {
      setDialog({ kind: 'error', message: extractErrorMessage(error, t('invSettings.writeFailed')) });
    }
  }

  // Registers not yet identified are kept for working them out, in development only.
  const sections = registers
    ? groupIntoSections(registers).filter((section) => import.meta.env.DEV || section.key !== 'unverified')
    : [];
  const q = query.trim().toLowerCase();
  const visible = (d: RegisterDefinition) =>
    (!q || d.label.toLowerCase().includes(q) || d.name.toLowerCase().includes(q) || (d.panelProgram ?? '').includes(q)) &&
    (filter === 'all' || (filter === 'changed' ? d.name in changes || d.name in errors : isNonDefault(d)));
  const shownSections = sections
    .map((section) => ({ ...section, registers: section.registers.filter(visible) }))
    .filter((section) => section.registers.length > 0);
  const nonDefaultCount = sections.flatMap((section) => section.registers).filter(isNonDefault).length;
  const saving = dialog?.kind === 'writing';

  return (
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
      <nav aria-label={t('invSettings.sections')} className="hidden lg:block">
        <div className="sticky top-24">
          <p className="mb-2 text-xs text-muted">{t('invSettings.sections')}</p>
          {sections.map((section) => {
            const changed = section.registers.filter((d) => d.name in changes).length;
            return (
              <a
                key={section.key}
                href={`#${sectionId(section.key)}`}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface-2"
              >
                {section.title}
                {changed > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-on-accent">
                    {changed}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3">
            <Search className="h-4 w-4 flex-none text-muted" />
            <input
              type="search"
              aria-label={t('invSettings.search')}
              placeholder={t('invSettings.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
            />
          </label>
          <Segmented
            ariaLabel={t('invSettings.show')}
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('invSettings.all') },
              { value: 'changed', label: t('invSettings.changed', { count: editedCount }) },
              { value: 'nondefault', label: t('invSettings.nonDefault', { count: nonDefaultCount }) },
            ]}
          />
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {snapshot && (
            <p role="status" className="text-[13px] text-muted">
              {t('invSettings.readAt', { time: new Date(snapshot.readAt).toLocaleString(currentLocale()) })}
            </p>
          )}
          <Button size="sm" onClick={() => void refresh()} disabled={refreshing || saving || !registers}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {t('invSettings.refresh')}
          </Button>
        </div>
        {refreshError && (
          <p role="alert" className="mb-4 rounded-lg border border-crit-line bg-crit-bg px-4 py-2 text-sm text-crit-ink">
            {refreshError}
          </p>
        )}

        {loadState === 'loading' && <p className="py-16 text-center text-sm text-muted">{t('invSettings.reading')}</p>}
        {loadState === 'error' && (
          <p role="alert" className="py-16 text-center text-sm text-crit-ink">
            {loadError}
          </p>
        )}

        {loadState === 'ready' && registers && (
          <div className="space-y-4">
            {readOnly ? (
              <p className="rounded-lg bg-surface-2 px-4 py-2.5 text-sm text-muted">{t(writesLocked ? 'invSettings.writesLocked' : 'invSettings.readOnly')}</p>
            ) : (
              <LithiumSetupHelper onPropose={propose} />
            )}
            {shownSections.length === 0 && (
              <p className="rounded-xl border border-dashed border-line-strong p-7 text-center text-sm text-muted">{t('invSettings.noMatch')}</p>
            )}
            {shownSections.map((section) => (
              <section key={section.key} id={sectionId(section.key)} className="scroll-mt-24 rounded-xl border border-line bg-surface">
                <h2 className="flex items-baseline gap-2 border-b border-line px-4 py-3 text-[15px] font-semibold">
                  {section.title}
                  <span className="text-xs font-normal text-muted">{t('invSettings.settingCount', { count: section.registers.length })}</span>
                </h2>
                <div className="divide-y divide-line">
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
                      panelPrograms={panelSettings.filter((p) => p.affects?.includes(definition.name)).map((p) => p.program)}
                      defaultValue={defaultOf(definition)}
                      disabled={saving || readOnly}
                      onChange={(text) => setForm((f) => ({ ...f, [definition.name]: text }))}
                    />
                  ))}
                </div>
              </section>
            ))}
            {panelSettings.length > 0 && filter === 'all' && !q && <PanelSettings settings={panelSettings} />}
          </div>
        )}

        {!readOnly && editedCount > 0 && (
          <>
            <div aria-hidden="true" className="h-20" />
            <div className="sticky bottom-20 z-10 -mt-16 flex items-center gap-2 rounded-xl bg-ink py-2 pr-2 pl-4 text-page shadow-xl md:bottom-4">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t('invSettings.unsavedCount', { count: editedCount })}</span>
              <button
                type="button"
                onClick={() => registers && snapshot && setForm(toFormValues(registers, snapshot.values))}
                className="h-9 rounded-lg border border-white/25 px-3 text-sm font-medium hover:bg-white/10"
              >
                {t('invSettings.discard')}
              </button>
              <button
                type="button"
                disabled={hasErrors || changeCount === 0 || saving}
                onClick={() => setDialog({ kind: 'review' })}
                className="h-9 rounded-lg bg-page px-3 text-sm font-semibold text-ink disabled:opacity-50"
              >
                {t('invSettings.review')}
              </button>
            </div>
          </>
        )}
      </div>

      <Dialog
        open={dialog?.kind === 'review'}
        title={t('invSettings.writeTitle', { count: changeCount })}
        width={560}
        onClose={() => setDialog(null)}
        actions={
          <>
            <Button onClick={() => setDialog(null)}>{t('invSettings.keepEditing')}</Button>
            <Button variant="primary" onClick={() => void write()}>
              {warnings.length || risks.length ? t('invSettings.writeAnyway') : t('invSettings.writeToInverter')}
            </Button>
          </>
        }
      >
        <p>{t('invSettings.appliesNow')}</p>
        <table className="mt-3 w-full overflow-hidden rounded-lg border border-line text-left text-sm text-ink">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-normal">{t('invSettings.setting')}</th>
              <th scope="col" className="px-3 py-2 font-normal">{t('invSettings.now')}</th>
              <th scope="col" className="px-3 py-2 font-normal">{t('invSettings.new')}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(changes).map(([name, value]) => {
              const d = definitionOf(name)!;
              return (
                <tr key={name} className="border-t border-line">
                  <th scope="row" className="px-3 py-2 font-normal">
                    {d.panelProgram && <span className="mr-1.5 font-mono text-[11px] text-muted">P{d.panelProgram}</span>}
                    {d.label}
                  </th>
                  <td className="px-3 py-2 text-muted">{formatRegisterValue(d, snapshot?.values[name])}</td>
                  <td className="px-3 py-2 font-semibold">{formatRegisterValue(d, value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(risks.length > 0 || warnings.length > 0) && (
          <ul className="mt-3 space-y-1.5 rounded-lg border border-warn-line bg-warn-bg px-3 py-2.5 text-sm text-warn-ink">
            {[...risks, ...warnings].map((message) => (
              <li key={message} className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" />
                <span>{message}</span>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <Dialog
        open={dialog !== null && dialog.kind !== 'review'}
        title={
          dialog?.kind === 'writing'
            ? t('invSettings.writing', { count: dialog.count })
            : dialog?.kind === 'error'
              ? t('invSettings.notTaken')
              : dialog?.kind === 'done'
                ? resultTitle(dialog.rows)
                : ''
        }
        width={520}
        onClose={() => dialog?.kind !== 'writing' && setDialog(null)}
        actions={
          dialog?.kind === 'writing' ? null : dialog?.kind === 'done' && dialog.rows.every((r) => r.ok) ? (
            <Button variant="primary" onClick={() => setDialog(null)}>
              {t('invSettings.done')}
            </Button>
          ) : (
            <>
              <Button onClick={() => setDialog({ kind: 'review' })}>{t('invSettings.retry')}</Button>
              <Button variant="primary" onClick={() => setDialog(null)}>
                {t('invSettings.close')}
              </Button>
            </>
          )
        }
      >
        {dialog?.kind === 'writing' && (
          <>
            <p>{t('invSettings.sending')}</p>
            <div className="mt-3 h-1 overflow-hidden rounded bg-surface-2">
              <div className="h-full w-3/5 animate-pulse rounded bg-accent" />
            </div>
          </>
        )}
        {dialog?.kind === 'error' && (
          <p role="alert" className="text-crit-ink">
            {dialog.message}
          </p>
        )}
        {dialog?.kind === 'done' && (
          <>
            <p>
              {dialog.rows.every((r) => r.ok)
                ? t('invSettings.readBackAt', { time: snapshot ? new Date(snapshot.readAt).toLocaleTimeString(currentLocale()) : '' })
                : t('invSettings.oldValue')}
            </p>
            <ul className="mt-3 overflow-hidden rounded-lg border border-line text-sm text-ink">
              {dialog.rows.map((r) => (
                <li key={r.name} className="flex items-start gap-2.5 border-t border-line px-3.5 py-2.5 first:border-t-0">
                  {r.ok ? <Check className="mt-0.5 h-4 w-4 flex-none text-good-ink" /> : <CircleAlert className="mt-0.5 h-4 w-4 flex-none text-crit-ink" />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>
                      {r.program && <span className="mr-1.5 font-mono text-[11px] text-muted">P{r.program}</span>}
                      {r.label}
                    </span>
                    <span className={'text-xs ' + (r.ok ? 'text-good-ink' : 'text-crit-ink')}>{r.note}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{r.value}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Dialog>
    </div>
  );
}

function resultTitle(rows: ResultRow[]): string {
  const ok = rows.filter((r) => r.ok).length;
  if (ok === rows.length) return i18n.t('invSettings.allConfirmed');
  return i18n.t('invSettings.someFailed', { count: rows.length - ok, ok, total: rows.length });
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
  const { t } = useTranslation();
  const id = `setting-${definition.name}`;
  const inputClass =
    'h-[38px] w-full rounded-lg border bg-surface px-3 text-sm text-ink disabled:opacity-60 sm:w-60 ' +
    (errors ? 'border-crit' : changed ? 'border-accent ring-1 ring-accent' : 'border-line-strong');

  const [open, setOpen] = useState(false);
  const facts = [
    defaultValue !== undefined && t('invSettings.default', { value: formatRegisterValue(definition, defaultValue) }),
  ].filter((fact): fact is string => Boolean(fact));
  const explained = definition.description || definition.optionDescriptions;

  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 ${changed ? 'bg-accent-soft' : ''}`}>
      <div className={`min-w-0 flex-1 ${inactive ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-1.5">
          <label htmlFor={id} className="text-[15px] font-medium text-ink">
            {definition.label}
          </label>
          {definition.panelProgram && (
            <span className="rounded bg-surface-2 px-1.5 font-mono text-[11px] text-muted">P{definition.panelProgram}</span>
          )}
          {changed && <span className="text-xs font-semibold text-accent">{t('invSettings.edited')}</span>}
          {explained && (
            <button
              type="button"
              aria-label={t('invSettings.about', { label: definition.label })}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="rounded text-muted hover:text-ink"
            >
              <Info className="h-4 w-4" />
            </button>
          )}
        </div>
        {inactive && <p className="mt-0.5 text-xs text-warn-ink">{inactive}</p>}
        {facts.length > 0 && (
          <p className="mt-0.5 flex gap-2 text-xs text-muted">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </p>
        )}
        {panelPrograms.map((program) => (
          <a
            key={program}
            href={`#panel-${program}`}
            className="mr-2 text-xs text-accent hover:underline"
          >
            {t('invSettings.dependsOn', { program })}
          </a>
        ))}
      </div>
      <div className="flex w-full flex-col items-stretch gap-1 sm:w-auto sm:items-end">
        {!definition.writable ? (
          <span id={id} className="text-sm font-semibold text-ink">
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
            {value === '' && <option value="">{t('invSettings.noData')}</option>}
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
            {value === '' && <option value="">{t('invSettings.noData')}</option>}
            {current !== undefined && !definition.choices.includes(current) && (
              <option value={current.toFixed(decimalsFor(definition))}>
                {t('invSettings.notPanelOption', { value: formatRegisterValue(definition, current) })}
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
              placeholder={t('invSettings.noData')}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              className={inputClass}
            />
            {definition.unit && (
              <span className="w-8 text-sm text-muted">{definition.unit}</span>
            )}
          </div>
        )}
        {bounds && (bounds.min !== undefined || bounds.max !== undefined) && (
          <p className="text-xs text-muted">{formatRange(definition, bounds)}</p>
        )}
        {warnings?.map((message) => (
          <p key={message} className="max-w-60 text-xs text-warn-ink">
            {message}
          </p>
        ))}
        {errors?.map((message) => (
          <p key={message} className="max-w-60 text-xs font-medium text-crit-ink">
            {message}
          </p>
        ))}
      </div>
      {open && explained && (
        <div className="basis-full rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
          {definition.description && <p>{definition.description}</p>}
          {definition.options && definition.optionDescriptions && (
            <dl className="mt-1.5 space-y-1">
              {definition.options.map((option, index) => (
                <div key={option}>
                  <dt className="inline font-medium text-ink">{option}: </dt>
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
  const { t } = useTranslation();
  return (
    <section aria-labelledby="panel-settings-title">
      <h2 id="panel-settings-title" className="mb-1 text-[15px] font-semibold">
        {t('invSettings.panelTitle')}
      </h2>
      <p className="mb-3 text-sm text-muted">
        {t('invSettings.panelIntro')}
      </p>
      <div className="divide-y divide-line rounded-xl border border-line bg-surface">
        {settings.map((setting) => (
          <div key={`${setting.program}-${setting.title}`} id={`panel-${setting.program}`} className="px-4 py-3">
            <p className="text-[15px] font-medium text-ink">{setting.title}</p>
            <p className="mt-0.5 text-xs text-muted">
              {t('invSettings.programDefault', { program: setting.program, value: setting.default })}
            </p>
            {setting.options && (
              <p className="mt-1 text-xs text-muted">{setting.options.join(', ')}</p>
            )}
            <p className="mt-1 text-xs text-muted">{setting.description}</p>
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
