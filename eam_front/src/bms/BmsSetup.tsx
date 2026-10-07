import { useState, type FormEvent } from 'react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { formatAge } from '../energy/freshness';
import type { BmsDevice } from './types';
import { useBmsDevices } from './useBmsDevices';
import { Button, Segmented } from '../ui';
import { CopyButton } from '../ui/CopyButton';
import { Dialog } from '../ui/Dialog';

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
    void act(async () => {
      await axios.delete(`/api/inverter/profiles/${profileId}/bms/${device.id}`);
    }, "Couldn't remove the BMS.");
  };

  const [asking, setAsking] = useState<{ kind: 'token' | 'remove'; device: BmsDevice } | null>(null);
  const ingest = token ? `BMS_INGEST_URL=${window.location.origin}/api/bms/ingest\nBMS_INGEST_TOKEN=${token}` : '';

  return (
    <section aria-label="Battery monitor (BMS)" className="space-y-4">
      <h2 className="sr-only">Battery monitor (BMS)</h2>
      {error && (
        <p role="alert" className="rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}
      {devices === null ? (
        <div className="h-24 animate-pulse rounded-xl border border-line bg-surface-2" />
      ) : devices.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-muted">No BMS yet.</p>
      ) : (
        <ul className="space-y-4">
          {devices.map((device) => (
            <li key={device.id} aria-label={device.name} className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
              <p className="flex flex-wrap items-center gap-2">
                <span className={'h-2 w-2 rounded-full ' + (device.lastSeenAt ? 'bg-good' : 'bg-idle')} />
                <span className="text-[15px] font-semibold">{device.name}</span>
                <span className="text-[13px] text-muted">
                  {sourceLabel(device.sourceType)} ·{' '}
                  {device.lastSeenAt ? `Last reading ${formatAge(now() - Date.parse(device.lastSeenAt))} ago` : 'No reading yet'}
                </span>
              </p>
              <label className="mt-3 flex items-center gap-3 text-sm">
                <Switch
                  label={`Use ${device.name} for the energy flow`}
                  on={device.useForEnergyFlow}
                  disabled={busy || readOnly}
                  onChange={(on) => setEnergyFlowSource(device, on)}
                />
                Use for the battery on the Overview
              </label>
              {!readOnly && (
                <p className="mt-2 text-xs text-muted">
                  Turn this on only once the current&apos;s sign is confirmed on the real BMS (first run, step 7): positive while charging, negative
                  while discharging.
                </p>
              )}
              {!readOnly && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" aria-label={`New token for ${device.name}`} disabled={busy} onClick={() => setAsking({ kind: 'token', device })}>
                    New reader token
                  </Button>
                  <button
                    type="button"
                    aria-label={`Remove ${device.name}`}
                    disabled={busy}
                    onClick={() => setAsking({ kind: 'remove', device })}
                    className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-crit-ink hover:bg-crit-bg"
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {token && (
        <section aria-label="New ingest token" className="rounded-xl border border-warn-line bg-warn-bg p-4 text-sm text-warn-ink">
          <p>
            Put these in the BMS reader&apos;s <code>.env</code>. The token is shown only once; if it is lost, make a new one.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs text-ink">{ingest}</pre>
          <div className="mt-3 flex gap-2">
            <CopyButton text={ingest} />
            <Button size="sm" onClick={() => setToken(null)}>
              Done
            </Button>
          </div>
        </section>
      )}

      {!readOnly && (
        <form onSubmit={add} className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
          <h3 className="text-[15px] font-semibold">Add a battery monitor</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink"
              />
            </label>
            <div>
              <p className="text-sm font-medium">How it is read</p>
              <div className="mt-1">
                <Segmented ariaLabel="How it is read" options={SOURCES} value={sourceType} onChange={setSourceType} />
              </div>
            </div>
          </div>
          <Button type="submit" variant="primary" className="mt-4" disabled={busy}>
            Add BMS
          </Button>
        </form>
      )}

      <Dialog
        open={asking !== null}
        title={asking?.kind === 'token' ? `Make a new reader token for ${asking.device.name}?` : `Remove ${asking?.device.name}?`}
        onClose={() => setAsking(null)}
        actions={
          <>
            <Button onClick={() => setAsking(null)}>Cancel</Button>
            <Button
              variant={asking?.kind === 'remove' ? 'danger' : 'primary'}
              onClick={() => {
                const a = asking;
                setAsking(null);
                if (a?.kind === 'token') replaceToken(a.device);
                if (a?.kind === 'remove') remove(a.device);
              }}
            >
              {asking?.kind === 'token' ? 'Make a new token' : 'Remove'}
            </Button>
          </>
        }
      >
        {asking?.kind === 'token'
          ? 'The reader stops working until it uses the new one.'
          : 'EAM stops taking its readings. Its stored readings are deleted too.'}
      </Dialog>
    </section>
  );
}

/** An on/off switch, announced as one. */
function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={'relative h-6 w-10 flex-none rounded-full transition disabled:opacity-50 ' + (on ? 'bg-good' : 'bg-line-strong')}
    >
      <span className={'absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ' + (on ? 'left-[19px]' : 'left-[3px]')} />
    </button>
  );
}
