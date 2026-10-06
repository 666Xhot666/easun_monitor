import { useState, type FormEvent } from 'react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { formatAge } from '../energy/freshness';
import type { BmsDevice } from './types';
import { useBmsDevices } from './useBmsDevices';

const SOURCES: { value: BmsDevice['sourceType']; label: string }[] = [
  { value: 'mac-ble', label: 'Mac Bluetooth reader' },
  { value: 'esp32', label: 'ESP32' },
];
const sourceLabel = (value: BmsDevice['sourceType']) =>
  SOURCES.find((s) => s.value === value)?.label ?? value;

interface Props {
  profileId: number;
  /** Clock, injectable for tests. */
  now?: () => number;
  /** Readers: the list only, no changes. */
  readOnly?: boolean;
}

/**
 * The inverter's battery monitors (BMS): add one, see when it last reported,
 * replace a lost ingest token, remove it. A token is shown only once.
 */
export default function BmsSetup({ profileId, now = Date.now, readOnly = false }: Props) {
  const { devices, reload } = useBmsDevices(profileId);
  const [name, setName] = useState('Battery');
  const [sourceType, setSourceType] = useState<BmsDevice['sourceType']>('mac-ble');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function act(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError('');
    try {
      await action();
      await reload();
    } catch (e) {
      setError(extractErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  const add = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      const { data } = await axios.post<{ token: string }>(`/api/inverter/profiles/${profileId}/bms`, {
        name,
        sourceType,
      });
      setToken(data.token);
    }, "Couldn't add the BMS.");
  };

  const replaceToken = (device: BmsDevice) => {
    if (
      !window.confirm(
        `Make a new ingest token for ${device.name}? The reader stops working until it uses the new one.`,
      )
    )
      return;
    void act(async () => {
      const { data } = await axios.post<{ token: string }>(
        `/api/inverter/profiles/${profileId}/bms/${device.id}/token`,
      );
      setToken(data.token);
    }, "Couldn't make a new token.");
  };

  const setEnergyFlowSource = (device: BmsDevice, on: boolean) => {
    void act(async () => {
      await axios.patch(`/api/inverter/profiles/${profileId}/bms/${device.id}`, { useForEnergyFlow: on });
    }, "Couldn't change the energy flow source.");
  };

  const remove = (device: BmsDevice) => {
    if (!window.confirm(`Remove ${device.name} and all its stored readings?`)) return;
    void act(async () => {
      await axios.delete(`/api/inverter/profiles/${profileId}/bms/${device.id}`);
    }, "Couldn't remove the BMS.");
  };

  const inputClass =
    'mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  const smallButton = 'text-xs font-medium text-gray-600 hover:underline dark:text-gray-300';

  return (
    <section aria-labelledby="bms-setup-title">
      <h2
        id="bms-setup-title"
        className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
      >
        Battery monitor (BMS)
      </h2>
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        {devices === null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No BMS yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {devices.map((device) => (
              <li key={device.id} aria-label={device.name} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{device.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {sourceLabel(device.sourceType)} ·{' '}
                    {device.lastSeenAt
                      ? `Last reading ${formatAge(now() - Date.parse(device.lastSeenAt))} ago`
                      : 'No reading yet'}
                  </p>
                  <label className="mt-1 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      aria-label={`Use ${device.name} for the energy flow`}
                      checked={device.useForEnergyFlow}
                      disabled={busy || readOnly}
                      onChange={(e) => setEnergyFlowSource(device, e.target.checked)}
                    />
                    Use for the battery in the energy flow
                  </label>
                </div>
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      aria-label={`New token for ${device.name}`}
                      disabled={busy}
                      onClick={() => replaceToken(device)}
                      className={smallButton}
                    >
                      New token
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${device.name}`}
                      disabled={busy}
                      onClick={() => remove(device)}
                      className={smallButton}
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {token && (
          <section
            aria-label="New ingest token"
            className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
          >
            <p>
              Put these in the BMS reader's <code>.env</code>. The token is shown only once; if it is lost,
              make a new one.
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-white p-2 font-mono text-xs text-gray-900 dark:bg-gray-950 dark:text-gray-100">
              {`BMS_INGEST_URL=${window.location.origin}/api/bms/ingest\nBMS_INGEST_TOKEN=${token}`}
            </pre>
            <button
              type="button"
              onClick={() => setToken(null)}
              className="mt-2 rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
            >
              Done
            </button>
          </section>
        )}

        {!readOnly && devices && devices.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Turn on the energy flow only once the current's sign is confirmed on the real BMS (first run, step 7):
            positive while charging, negative while discharging.
          </p>
        )}

        {!readOnly && (
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              Reads it
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as BmsDevice['sourceType'])}
                className={inputClass}
              >
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              Add BMS
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
