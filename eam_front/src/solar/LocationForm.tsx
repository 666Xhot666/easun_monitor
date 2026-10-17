import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';

interface Props {
  profileId: number;
  latitude: number | null;
  longitude: number | null;
  pvTiltDeg: number | null;
  pvFacingDeg: number | null;
  /** Called after a save, so the profile can be reloaded. */
  onSaved: () => void;
  /** Readers: the values only, no changes. */
  readOnly?: boolean;
}

/** A coordinate from an input, or null when blank or invalid. */
const toCoordinate = (text: string): number | null => {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) ? value : null;
};

const toText = (value: number | null) => (value === null ? '' : String(value));

/** Compass bearings the panels can face, as offered. */
const FACINGS = [
  ['north', 0],
  ['northEast', 45],
  ['east', 90],
  ['southEast', 135],
  ['south', 180],
  ['southWest', 225],
  ['west', 270],
  ['northWest', 315],
] as const;

type Field = 'latitude' | 'longitude' | 'pvTiltDeg' | 'pvFacingDeg';

/** Where the installation is and how its panels are mounted, for the weather. */
export default function LocationForm({ profileId, latitude, longitude, pvTiltDeg, pvFacingDeg, onSaved, readOnly = false }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Record<Field, string>>({
    latitude: toText(latitude),
    longitude: toText(longitude),
    pvTiltDeg: toText(pvTiltDeg),
    pvFacingDeg: toText(pvFacingDeg),
  });
  const [busy, setBusy] = useState<'detecting' | 'saving' | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const update = (field: Field) => (text: string) => {
    setForm((f) => ({ ...f, [field]: text }));
    setSaved(false);
  };

  async function detect() {
    setBusy('detecting');
    setError('');
    try {
      const { data } = await axios.get<{ latitude: number; longitude: number }>('/api/location/detect');
      setForm((f) => ({ ...f, latitude: String(data.latitude), longitude: String(data.longitude) }));
      setSaved(false);
    } catch (e) {
      setError(extractErrorMessage(e, t('solar.location.detectFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy('saving');
    setError('');
    try {
      await axios.patch(`/api/inverter/profiles/${profileId}`, {
        latitude: toCoordinate(form.latitude),
        longitude: toCoordinate(form.longitude),
        pvTiltDeg: toCoordinate(form.pvTiltDeg),
        pvFacingDeg: toCoordinate(form.pvFacingDeg),
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(extractErrorMessage(e, t('solar.location.saveFailed')));
    } finally {
      setBusy(null);
    }
  }

  const inputClass = 'mt-1 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink disabled:opacity-60';
  const coordinate = (field: 'latitude' | 'longitude' | 'pvTiltDeg', min: number, max: number) => (
    <label className="block text-sm font-medium">
      {t(`solar.location.${field}`)}
      <input
        type="number"
        min={min}
        max={max}
        step="any"
        value={form[field]}
        disabled={readOnly}
        onChange={(e) => update(field)(e.target.value)}
        className={inputClass}
      />
    </label>
  );

  return (
    <form onSubmit={(e) => void save(e)} className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h3 className="text-[15px] font-semibold">{t('solar.location.title')}</h3>
      <p className="mt-1 text-sm text-muted">{t('solar.location.hint')}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {coordinate('latitude', -90, 90)}
        {coordinate('longitude', -180, 180)}
        {coordinate('pvTiltDeg', 0, 90)}
        <label className="block text-sm font-medium">
          {t('solar.location.pvFacingDeg')}
          <select
            value={form.pvFacingDeg}
            disabled={readOnly}
            onChange={(e) => update('pvFacingDeg')(e.target.value)}
            className={inputClass}
          >
            <option value="">{t('solar.location.facingUnknown')}</option>
            {FACINGS.map(([name, bearing]) => (
              <option key={name} value={String(bearing)}>
                {t(`solar.location.facings.${name}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {saved && <span className="text-sm text-good-ink">{t('solar.location.saved')}</span>}
        {error && (
          <p role="alert" className="text-sm text-crit-ink">
            {error}
          </p>
        )}
        {!readOnly && (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void detect()}
              className="h-10 rounded-lg border border-line-strong px-4 text-sm font-semibold text-ink transition hover:bg-surface-2 disabled:opacity-50"
            >
              {busy === 'detecting' ? t('solar.location.detecting') : t('solar.location.detect')}
            </button>
            <button
              type="submit"
              disabled={busy !== null}
              className="h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-page transition hover:opacity-90 disabled:opacity-50"
            >
              {t('solar.location.save')}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
