import { useState, type FormEvent } from 'react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { ageText } from '../shell/age';
import { Button } from '../ui';
import { CopyButton } from '../ui/CopyButton';
import { Dialog } from '../ui/Dialog';
import { Switch } from '../ui/Switch';
import type { OutageSource } from './types';
import { useOutageCities, useOutageSource, useOutageStreets } from './useOutage';

interface Props {
  profileId: number;
  /** Clock, injectable for tests. */
  now?: () => number;
  /** Readers: the address and its state only, no changes. */
  readOnly?: boolean;
}

const groupName = (group: string) => group.replace(/^GPV/, '');

/** What the reader found for the address, in a sentence. */
function houseText(source: OutageSource): string {
  if (source.houseState === 'PENDING') {
    return source.lastSeenAt ? "Waiting for the reader's next check." : "The reader hasn't connected yet.";
  }
  if (source.houseState === 'NOT_FOUND') {
    return 'The house is not on the site for this street. Check how the site writes its number.';
  }
  const groups = source.groups.map(groupName);
  if (groups.length === 0) return 'The site lists no outage group for this house.';
  if (groups.length === 1) return `Group ${groups[0]}`;
  return `Groups ${groups.join(', ')}: the house is on several groups; the outages of all of them are shown.`;
}

/**
 * The inverter's DTEK address for the outage schedule: city and street from
 * the site's own lists, the house as typed, and what the reader found for it.
 * The reader token is shown only once.
 */
export default function OutageSetup({ profileId, now = Date.now, readOnly = false }: Props) {
  const { source, setSource, reload } = useOutageSource(profileId);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState<'token' | 'remove' | null>(null);
  const path = `/api/inverter/profiles/${profileId}/outage-source`;

  async function act(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(extractErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  const save = (address: { city: string; street: string; house: string; enabled?: boolean }) =>
    act(async () => {
      const { data } = await axios.put<{ source: OutageSource; token?: string }>(path, address);
      setSource(data.source);
      if (data.token) setToken(data.token);
    }, "Couldn't save the address.");

  const replaceToken = () =>
    act(async () => {
      const { data } = await axios.post<{ token: string }>(`${path}/token`);
      setToken(data.token);
    }, "Couldn't make a new token.");

  const remove = () =>
    act(async () => {
      await axios.delete(path);
      setToken(null);
      await reload();
    }, "Couldn't remove the address.");

  const settings = token ? `OUTAGE_SERVER_URL=${window.location.origin}\nOUTAGE_READER_TOKEN=${token}` : '';

  return (
    <section aria-label="Outage schedule" className="space-y-4">
      <h2 className="sr-only">Outage schedule</h2>
      {error && (
        <p role="alert" className="rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}
      {source === undefined ? (
        <div className="h-24 animate-pulse rounded-xl border border-line bg-surface-2" />
      ) : source === null ? (
        <p className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-muted">
          No address yet. With one set, the outage schedule reader checks the DTEK Dnipro site for it.
        </p>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
          <p className="text-[15px] font-semibold">
            {source.city}, {source.street}, {source.house}
          </p>
          <p className="mt-1 text-sm">{houseText(source)}</p>
          {source.lastSeenAt && (
            <p className="mt-1 text-[13px] text-muted">Reader last asked {ageText(now() - Date.parse(source.lastSeenAt))} ago</p>
          )}
          <label className="mt-3 flex items-center gap-3 text-sm">
            <Switch
              label="Check the outage schedule"
              on={source.enabled}
              disabled={busy || readOnly}
              onChange={(enabled) => void save({ city: source.city, street: source.street, house: source.house, enabled })}
            />
            Check the outage schedule
          </label>
          {!readOnly && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => setAsking('token')}>
                New reader token
              </Button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setAsking('remove')}
                className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-crit-ink hover:bg-crit-bg"
              >
                Remove address
              </button>
            </div>
          )}
        </div>
      )}

      {token && (
        <section aria-label="Reader settings" className="rounded-xl border border-warn-line bg-warn-bg p-4 text-sm text-warn-ink">
          <p>
            Put these in the outage schedule reader&apos;s <code>.env</code>. The token is shown only once; if it is lost, make a new one.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs text-ink">{settings}</pre>
          <div className="mt-3 flex gap-2">
            <CopyButton text={settings} />
            <Button size="sm" onClick={() => setToken(null)}>
              Done
            </Button>
          </div>
        </section>
      )}

      {!readOnly && source !== undefined && (
        <AddressForm key={source?.id ?? 'new'} initial={source} busy={busy} onSave={(address) => void save(address)} />
      )}

      <Dialog
        open={asking !== null}
        title={asking === 'token' ? 'Make a new reader token?' : 'Remove the address?'}
        onClose={() => setAsking(null)}
        actions={
          <>
            <Button onClick={() => setAsking(null)}>Cancel</Button>
            <Button
              variant={asking === 'remove' ? 'danger' : 'primary'}
              onClick={() => {
                const a = asking;
                setAsking(null);
                if (a === 'token') void replaceToken();
                if (a === 'remove') void remove();
              }}
            >
              {asking === 'token' ? 'Make a new token' : 'Remove'}
            </Button>
          </>
        }
      >
        {asking === 'token'
          ? 'The reader stops working until it uses the new one.'
          : 'The reader stops checking. The stored schedule and outages of this address are deleted too.'}
      </Dialog>
    </section>
  );
}

function AddressForm({
  initial,
  busy,
  onSave,
}: {
  initial: OutageSource | null;
  busy: boolean;
  onSave: (address: { city: string; street: string; house: string }) => void;
}) {
  const [city, setCity] = useState(initial?.city ?? '');
  const [street, setStreet] = useState(initial?.street ?? '');
  const [house, setHouse] = useState(initial?.house ?? '');
  const cities = useOutageCities();
  const streets = useOutageStreets(city, cities?.includes(city) ?? false);
  const input = 'mt-1 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ city: city.trim(), street: street.trim(), house: house.trim() });
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h3 className="text-[15px] font-semibold">{initial ? 'Change the address' : 'Set the address'}</h3>
      {cities?.length === 0 && (
        <p className="mt-1 text-[13px] text-muted">
          The lists of cities and streets appear after the reader&apos;s first check; until then, type them as the DTEK site writes them.
        </p>
      )}
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <label className="block text-sm font-medium">
          City
          <input value={city} list="outage-cities" required onChange={(e) => setCity(e.target.value)} className={input} />
        </label>
        <label className="block text-sm font-medium">
          Street
          <input value={street} list="outage-streets" required onChange={(e) => setStreet(e.target.value)} className={input} />
        </label>
        <label className="block text-sm font-medium">
          House
          <input value={house} required maxLength={40} onChange={(e) => setHouse(e.target.value)} className={input} />
        </label>
      </div>
      <datalist id="outage-cities">
        {cities?.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </datalist>
      <datalist id="outage-streets">
        {streets.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </datalist>
      <Button type="submit" variant="primary" className="mt-4" disabled={busy}>
        Save address
      </Button>
    </form>
  );
}
