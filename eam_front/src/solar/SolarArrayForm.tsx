import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { plain, plainUnit } from '../i18n/format';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import type { InverterProfile } from '../auth/types';
import { checkArray, COLD_VOC_MARGIN, computeArray, type ArrayWarning, type PanelType } from './pvArray';

/** The profile fields this form edits, in the order they are sent. */
const FIELDS = [
  'pvPanelTypeId',
  'pvPanelsInSeries',
  'pvStrings',
  'pvMaxVocV',
  'pvMpptMinV',
  'pvMpptMaxV',
  'pvMaxPowerW',
  'pvMaxCurrentA',
] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

const LIMITS: { field: Field }[] = [
  { field: 'pvMaxVocV' },
  { field: 'pvMpptMinV' },
  { field: 'pvMpptMaxV' },
  { field: 'pvMaxPowerW' },
  { field: 'pvMaxCurrentA' },
];

const WARNING_STYLES: Record<ArrayWarning['level'], string> = {
  danger: 'border border-crit-line bg-crit-bg text-crit-ink',
  warning: 'border border-warn-line bg-warn-bg text-warn-ink',
  info: 'bg-surface-2 text-ink',
};

const toForm = (profile: InverterProfile): Form =>
  Object.fromEntries(FIELDS.map((f) => [f, profile[f] === null ? '' : String(profile[f])])) as Form;

/** A positive number from an input, or null when blank or invalid. */
const toNumber = (text: string): number | null => {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null;
};

const toWholeNumber = (text: string): number | null => {
  const value = toNumber(text);
  return value !== null && Number.isInteger(value) ? value : null;
};

interface Props {
  profile: InverterProfile;
  panelTypes: PanelType[];
  /** Called after a save, so the profile can be reloaded. */
  onSaved: () => void;
  /** Readers: the values only, no changes. */
  readOnly?: boolean;
}

/** The inverter's solar array (panel type and wiring) and its PV input limits, with the array's ratings. */
export default function SolarArrayForm({ profile, panelTypes, onSaved, readOnly = false }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Form>(() => toForm(profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const panel = panelTypes.find((t) => t.id === toWholeNumber(form.pvPanelTypeId));
  const inSeries = toWholeNumber(form.pvPanelsInSeries);
  const strings = toWholeNumber(form.pvStrings);
  const array = panel && inSeries && strings ? computeArray(panel, { inSeries, strings }) : null;
  const warnings = array
    ? checkArray(array, {
        maxVocV: toNumber(form.pvMaxVocV),
        mpptMinV: toNumber(form.pvMpptMinV),
        mpptMaxV: toNumber(form.pvMpptMaxV),
        maxPowerW: toNumber(form.pvMaxPowerW),
        maxCurrentA: toNumber(form.pvMaxCurrentA),
      })
    : [];

  const update = (field: Field) => (text: string) => {
    setForm((f) => ({ ...f, [field]: text }));
    setSaved(false);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = Object.fromEntries(
        FIELDS.map((f) => [
          f,
          f === 'pvPanelTypeId' || f === 'pvPanelsInSeries' || f === 'pvStrings'
            ? toWholeNumber(form[f])
            : toNumber(form[f]),
        ]),
      );
      await axios.patch(`/api/inverter/profiles/${profile.id}`, body);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(extractErrorMessage(e, t('solar.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'mt-1 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink disabled:opacity-60';
  const labelClass = 'block text-sm font-medium';
  const numberInput = (field: Field, label: string, step = 'any') => (
    <label className={labelClass}>
      {label}
      <input
        type="number"
        min="0"
        step={step}
        value={form[field]}
        disabled={readOnly}
        onChange={(e) => update(field)(e.target.value)}
        className={inputClass}
      />
    </label>
  );
  const stepper = (field: 'pvPanelsInSeries' | 'pvStrings', label: string, less: string, more: string) => {
    const value = toWholeNumber(form[field]) ?? 0;
    const button = 'grid w-10 flex-none place-items-center text-lg text-ink hover:bg-surface-2 disabled:opacity-40';
    return (
      <div>
        <label htmlFor={`array-${field}`} className={labelClass}>
          {label}
        </label>
        <span className="mt-1 flex h-10 overflow-hidden rounded-lg border border-line-strong bg-surface">
          <button type="button" aria-label={less} disabled={readOnly || value <= 1} onClick={() => update(field)(String(value - 1))} className={button}>
            −
          </button>
          <input
            id={`array-${field}`}
            type="number"
            min="1"
            step="1"
            value={form[field]}
            disabled={readOnly}
            onChange={(e) => update(field)(e.target.value)}
            className="w-full min-w-0 border-x border-line bg-transparent text-center text-sm font-semibold tabular-nums text-ink [appearance:textfield] disabled:opacity-60"
          />
          <button type="button" aria-label={more} disabled={readOnly} onClick={() => update(field)(String(value + 1))} className={button}>
            +
          </button>
        </span>
      </div>
    );
  };

  const limits = {
    mpptMin: toNumber(form.pvMpptMinV),
    mpptMax: toNumber(form.pvMpptMaxV),
    maxVoc: toNumber(form.pvMaxVocV),
  };

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4">
      <section className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
        <h3 className="text-[15px] font-semibold">{t('solar.array')}</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className={labelClass}>
            {t('solar.panelType')}
            <select
              value={form.pvPanelTypeId}
              disabled={readOnly}
              onChange={(e) => update('pvPanelTypeId')(e.target.value)}
              className={inputClass}
            >
              <option value="">{t('solar.none')}</option>
              {panelTypes.map((type) => (
                <option key={type.id} value={String(type.id)}>
                  {type.name} · {plainUnit(type.maxPowerW, 'W')}
                </option>
              ))}
            </select>
          </label>
          {stepper('pvPanelsInSeries', t('solar.inSeries'), t('solar.fewerInSeries'), t('solar.moreInSeries'))}
          {stepper('pvStrings', t('solar.strings'), t('solar.fewerStrings'), t('solar.moreStrings'))}
        </div>

        <section aria-label={t('solar.ratings')} className="mt-4">
          {array && inSeries && strings ? (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xl font-semibold">
                  {t('solar.panelsCount', { count: array.panels, layout: `${inSeries}S${strings}P` })}
                </span>
                <span className="text-xl font-semibold text-muted">·</span>
                <span className="text-xl font-semibold tabular-nums">{plainUnit(array.powerW, 'W')}</span>
              </p>
              <ul aria-label={t('solar.stringLayout')} className="mt-3 flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
                {Array.from({ length: Math.min(strings, 8) }, (_, i) => (
                  <li key={i} aria-label={t('solar.stringN', { n: i + 1 })} className="flex items-center gap-3">
                    <span className="w-16 flex-none font-mono text-xs text-muted">{t('solar.stringN', { n: i + 1 })}</span>
                    <span className="flex flex-wrap gap-1">
                      {Array.from({ length: Math.min(inSeries, 30) }, (_, j) => (
                        <span key={j} className="h-8 w-6 rounded-[3px] border border-pv bg-pv-fill" />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ['Vmp', plainUnit(array.vmpV, 'V')],
                  ['Voc', plainUnit(array.vocV, 'V')],
                  ['Imp', plainUnit(array.impA, 'A')],
                  ['Isc', plainUnit(array.iscA, 'A')],
                ].map(([label, value]) => (
                  <p key={label}>
                    <span className="block text-xs text-muted">{label}</span>{' '}
                    <span className="text-lg font-semibold tabular-nums">{value}</span>
                  </p>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">{t('solar.chooseFirst')}</p>
          )}
        </section>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
        <h3 className="text-[15px] font-semibold">{t('solar.voltageTitle')}</h3>
        {array && <VoltageBar vmpV={array.vmpV} vocV={array.vocV} {...limits} />}
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-2 text-sm">
            {warnings.map((w) => (
              <li key={w.message} className={'rounded-lg px-3 py-2.5 ' + WARNING_STYLES[w.level]}>
                <b className="mr-2 font-semibold">{t(`solar.levels.${w.level}`)}</b>
                {w.message}
              </li>
            ))}
          </ul>
        )}
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">
            {t('solar.limits')} <span className="font-normal text-muted">{t('solar.limitsHint')}</span>
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-5">
            {LIMITS.map(({ field }) => (
              <div key={field}>{numberInput(field, t(`solar.limitFields.${field}`))}</div>
            ))}
          </div>
        </fieldset>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved && <span className="text-sm text-good-ink">{t('solar.saved')}</span>}
        {error && (
          <p role="alert" className="text-sm text-crit-ink">
            {error}
          </p>
        )}
        {!readOnly && (
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-page transition hover:opacity-90 disabled:opacity-50"
          >
            {t('solar.save')}
          </button>
        )}
      </div>
    </form>
  );
}

/** Vmp, Voc and cold-morning Voc on a 0–600 V scale, against the MPPT window and the maximum input voltage. */
function VoltageBar({
  vmpV,
  vocV,
  mpptMin,
  mpptMax,
  maxVoc,
}: {
  vmpV: number;
  vocV: number;
  mpptMin: number | null;
  mpptMax: number | null;
  maxVoc: number | null;
}) {
  const { t } = useTranslation();
  const coldVoc = Math.round(vocV * (1 + COLD_VOC_MARGIN) * 10) / 10;
  const volts = (value: number) => plainUnit(value, 'V');
  const top = Math.max(600, Math.ceil((Math.max(coldVoc, maxVoc ?? 0) * 1.1) / 100) * 100);
  const x = (v: number) => `${Math.min(100, (v / top) * 100)}%`;
  const limitsText = [
    mpptMin !== null && mpptMax !== null ? t('solar.mpptWindowValue', { min: plain(mpptMin), max: volts(mpptMax) }) : null,
    maxVoc !== null ? t('solar.maxVocValue', { value: volts(maxVoc) }) : null,
  ].filter(Boolean);
  const label = `${t('solar.barLabel', { vmp: volts(vmpV), voc: volts(vocV), cold: volts(coldVoc) })}${
    limitsText.length ? `; ${limitsText.join(', ')}` : ''
  }`;
  const markers = [
    { name: 'Vmp', v: vmpV, colour: 'var(--text)' },
    { name: 'Voc', v: vocV, colour: 'var(--pv)' },
    { name: t('solar.coldVoc'), v: coldVoc, colour: 'var(--grid)' },
  ];
  return (
    <div className="mt-3">
      <div role="img" aria-label={label} className="relative h-10 overflow-hidden rounded-lg bg-surface-2">
        {mpptMin !== null && mpptMax !== null && (
          <span
            className="absolute inset-y-0 border-x border-dashed border-good bg-good-bg"
            style={{ left: x(mpptMin), width: `calc(${x(mpptMax)} - ${x(mpptMin)})` }}
          />
        )}
        {maxVoc !== null && (
          <span className="absolute inset-y-0 right-0 border-l-2 border-crit bg-crit-bg" style={{ left: x(maxVoc) }} />
        )}
        {markers.map((m) => (
          <span key={m.name} className="absolute top-2 bottom-2 w-[3px] -translate-x-1/2 rounded" style={{ left: x(m.v), background: m.colour }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
        <span>{volts(0)}</span>
        <span>{volts(top / 3)}</span>
        <span>{volts((2 * top) / 3)}</span>
        <span>{volts(top)}</span>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-hidden="true">
        {mpptMin !== null && mpptMax !== null && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] border border-good bg-good-bg" />
            {t('solar.mpptWindow')} <b>{plain(mpptMin)}–{volts(mpptMax)}</b>
          </span>
        )}
        {markers.map((m) => (
          <span key={m.name} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: m.colour }} />
            {m.name} <b className="tabular-nums">{plainUnit(Math.round(m.v), 'V')}</b>
          </span>
        ))}
        {maxVoc !== null && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-crit" />
            {t('solar.maxVoc')} <b>{volts(maxVoc)}</b>
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-muted">{t('solar.coldHint', { margin: COLD_VOC_MARGIN * 100 })}</p>
    </div>
  );
}
