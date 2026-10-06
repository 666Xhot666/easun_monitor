import { useState, type FormEvent } from 'react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import type { InverterProfile } from '../auth/types';
import { checkArray, computeArray, type ArrayWarning, type PanelType } from './pvArray';

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

const LIMITS: { field: Field; label: string }[] = [
  { field: 'pvMaxVocV', label: 'Max open-circuit voltage (V)' },
  { field: 'pvMpptMinV', label: 'MPPT minimum (V)' },
  { field: 'pvMpptMaxV', label: 'MPPT maximum (V)' },
  { field: 'pvMaxPowerW', label: 'Max PV input power (W)' },
  { field: 'pvMaxCurrentA', label: 'Max PV input current (A)' },
];

const WARNING_STYLES: Record<ArrayWarning['level'], string> = {
  danger: 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  info: 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
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
}

/** The inverter's solar array (panel type and wiring) and its PV input limits, with the array's ratings. */
export default function SolarArrayForm({ profile, panelTypes, onSaved }: Props) {
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
      setError(extractErrorMessage(e, "Couldn't save the array."));
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  const labelClass = 'block text-xs font-medium text-gray-600 dark:text-gray-300';
  const numberInput = (field: Field, label: string, step = 'any') => (
    <label className={labelClass}>
      {label}
      <input
        type="number"
        min="0"
        step={step}
        value={form[field]}
        onChange={(e) => update(field)(e.target.value)}
        className={inputClass}
      />
    </label>
  );

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={labelClass}>
          Panel type
          <select
            value={form.pvPanelTypeId}
            onChange={(e) => update('pvPanelTypeId')(e.target.value)}
            className={inputClass}
          >
            <option value="">— None —</option>
            {panelTypes.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {numberInput('pvPanelsInSeries', 'Panels in series per string', '1')}
        {numberInput('pvStrings', 'Strings in parallel', '1')}
      </div>

      <section aria-label="Array ratings" className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-900/50">
        {array && inSeries && strings ? (
          <>
            <p className="font-medium text-gray-900 dark:text-gray-100">
              {array.panels} panels ({inSeries}S{strings}P) · {array.powerW} W
            </p>
            <p className="mt-1 text-gray-600 dark:text-gray-300">
              Vmp {array.vmpV} V · Voc {array.vocV} V · Imp {array.impA} A · Isc {array.iscA} A
            </p>
            {warnings.length > 0 && (
              <ul className="mt-3 space-y-2">
                {warnings.map((w) => (
                  <li key={w.message} className={`rounded-lg px-3 py-2 ${WARNING_STYLES[w.level]}`}>
                    {w.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">Choose a panel type and the wiring to see the array ratings.</p>
        )}
      </section>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
          Inverter PV input limits <span className="font-normal text-gray-500 dark:text-gray-400">(from the specification table in the manual; optional)</span>
        </legend>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {LIMITS.map(({ field, label }) => (
            <div key={field}>{numberInput(field, label)}</div>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          Save array
        </button>
        {saved && <span className="text-sm text-green-700 dark:text-green-400">Saved.</span>}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
