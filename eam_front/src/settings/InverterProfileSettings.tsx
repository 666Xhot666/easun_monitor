import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useAuth } from '../auth/useAuth';
import type { BatteryType, InverterProfile } from '../auth/types';
import { useLiveData } from '../shell/LiveData';
import { Button, Card, CardTitle, Segmented } from '../ui';
import { Dialog } from '../ui/Dialog';

const POWER_PRESETS = ['3600', '5000', '6200'] as const;
const VOLTAGES = ['12', '24', '48'] as const;
const CHEMISTRIES: { value: BatteryType; label: string }[] = [
  { value: 'LIFEPO4', label: 'LiFePO4' },
  { value: 'LEAD_ACID', label: 'Lead-acid' },
  { value: 'GEL', label: 'GEL' },
  { value: 'USER_DEFINED', label: 'User-defined' },
];

interface Form {
  name: string;
  ipAddress: string;
  port: string;
  power: string;
  customPower: string;
  batteryNominalVoltage: string;
  batteryType: BatteryType;
  batteryCapacityAh: string;
}

const toForm = (p: InverterProfile): Form => {
  const preset = (POWER_PRESETS as readonly string[]).includes(String(p.ratedPowerWatts));
  return {
    name: p.name,
    ipAddress: p.ipAddress,
    port: String(p.port),
    power: preset ? String(p.ratedPowerWatts) : 'custom',
    customPower: preset ? '' : String(p.ratedPowerWatts),
    batteryNominalVoltage: String(p.batteryNominalVoltage),
    batteryType: p.batteryType,
    batteryCapacityAh: String(p.batteryCapacityAh),
  };
};

/** The fields of PATCH /api/inverter/profiles/:id that differ from the profile. */
function changedFields(profile: InverterProfile, form: Form): Partial<InverterProfile> | null {
  const ratedPowerWatts = Number(form.power === 'custom' ? form.customPower : form.power);
  const next: Partial<InverterProfile> = {
    name: form.name.trim(),
    ipAddress: form.ipAddress.trim(),
    port: Number(form.port),
    ratedPowerWatts,
    batteryNominalVoltage: Number(form.batteryNominalVoltage),
    batteryType: form.batteryType,
    batteryCapacityAh: Number(form.batteryCapacityAh),
  };
  if (!next.name || !next.ipAddress || !(next.port! > 0) || !(ratedPowerWatts > 0) || !(next.batteryCapacityAh! > 0)) return null;
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => profile[key as keyof InverterProfile] !== value),
  ) as Partial<InverterProfile>;
}

const input = 'mt-1 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink';

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** The inverter as paired, editable by admins: how EAM reaches it and what it powers; removing it from EAM. */
export default function InverterProfileSettings() {
  const { profile } = useLiveData();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(() => toForm(profile));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [test, setTest] = useState<{ state: 'idle' | 'testing' } | { state: 'ok' | 'failed'; message: string }>({ state: 'idle' });
  const [confirming, setConfirming] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const canRemove = (user?.inverterProfiles.length ?? 0) > 1;
  const changes = changedFields(profile, form);
  const dirty = changes !== null && Object.keys(changes).length > 0;

  const update = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!changes || !dirty) return;
    setSaving(true);
    setError('');
    try {
      await axios.patch(`/api/inverter/profiles/${profile.id}`, changes);
      await refreshUser();
      setSaved(true);
    } catch (e) {
      setError(extractErrorMessage(e, 'Couldn’t save the profile.'));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTest({ state: 'testing' });
    try {
      const { data } = await axios.post<{ latencyMs: number; sampledParameter: string }>('/api/inverter/pair/test', {
        ipAddress: form.ipAddress.trim(),
        port: Number(form.port) || 8899,
      });
      setTest({ state: 'ok', message: `Connected — read ${data.sampledParameter} in ${data.latencyMs} ms.` });
    } catch (e) {
      setTest({ state: 'failed', message: extractErrorMessage(e, 'Couldn’t reach the logger at that address.') });
    }
  }

  async function remove() {
    setRemoveError('');
    try {
      await axios.delete(`/api/inverter/profiles/${profile.id}`);
      setConfirming(false);
      await refreshUser();
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setRemoveError(extractErrorMessage(e, 'Couldn’t remove the inverter.'));
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4">
      <Card>
        <CardTitle>Connection</CardTitle>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <Field label="Name" htmlFor="profile-name">
            <input id="profile-name" className={input} value={form.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <Field label="Logger IP or hostname" htmlFor="profile-ip" hint="Find it in your router’s device list or in the SmartESS app.">
            <input
              id="profile-ip"
              className={input}
              value={form.ipAddress}
              onChange={(e) => {
                update({ ipAddress: e.target.value });
                setTest({ state: 'idle' });
              }}
            />
          </Field>
          <Field label="Port" htmlFor="profile-port" hint="Usually 8899.">
            <input id="profile-port" type="number" min={1} max={65535} className={input} value={form.port} onChange={(e) => update({ port: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void testConnection()} disabled={test.state === 'testing' || !form.ipAddress.trim()}>
            {test.state === 'testing' ? 'Testing…' : 'Test connection'}
          </Button>
          {(test.state === 'ok' || test.state === 'failed') && (
            <p role="status" className={'text-sm ' + (test.state === 'ok' ? 'text-good-ink' : 'text-crit-ink')}>
              {test.message}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>Power and battery bank</CardTitle>
        <div className="mt-3 space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium">Rated power</p>
            <Segmented
              ariaLabel="Rated power"
              value={form.power}
              onChange={(power) => update({ power })}
              options={[...POWER_PRESETS.map((w) => ({ value: w as string, label: `${(Number(w) / 1000).toFixed(1)} kW` })), { value: 'custom', label: 'Custom' }]}
            />
            {form.power === 'custom' && (
              <div className="mt-2 max-w-60">
                <Field label="Rated power (W)" htmlFor="profile-power">
                  <input id="profile-power" type="number" min={1} className={input} value={form.customPower} onChange={(e) => update({ customPower: e.target.value })} />
                </Field>
              </div>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1.5 text-sm font-medium">Battery voltage</p>
              <Segmented
                ariaLabel="Battery voltage"
                value={form.batteryNominalVoltage}
                onChange={(batteryNominalVoltage) => update({ batteryNominalVoltage })}
                options={VOLTAGES.map((v) => ({ value: v as string, label: `${v} V` }))}
              />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">Chemistry</p>
              <Segmented ariaLabel="Chemistry" value={form.batteryType} onChange={(batteryType) => update({ batteryType })} options={CHEMISTRIES} />
            </div>
          </div>
          <div className="max-w-60">
            <Field label="Capacity (Ah)" htmlFor="profile-capacity">
              <input
                id="profile-capacity"
                type="number"
                min={1}
                className={input}
                value={form.batteryCapacityAh}
                onChange={(e) => update({ batteryCapacityAh: e.target.value })}
              />
            </Field>
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-muted">
            <Info className="mt-0.5 h-4 w-4 flex-none" />
            <span>
              Charge and cut-off voltages are written to the inverter itself. Change them in{' '}
              <Link to={`/dashboard/${profile.id}/settings/inverter-settings`} className="text-accent underline">
                Inverter settings
              </Link>
              .
            </span>
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved && <span className="text-sm text-good-ink">Saved.</span>}
        {error && (
          <span role="alert" className="text-sm text-crit-ink">
            {error}
          </span>
        )}
        <Button type="submit" variant="primary" disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>

      {canRemove && (
        <Card>
          <CardTitle>Remove inverter</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Removes {profile.name} from EAM. Its recorded history is kept; the inverter and its logger are not changed.
          </p>
          <div className="mt-4">
            <Button variant="danger-soft" onClick={() => setConfirming(true)}>
              Remove {profile.name}…
            </Button>
          </div>
          {removeError && (
            <p role="alert" className="mt-3 text-sm text-crit-ink">
              {removeError}
            </p>
          )}
        </Card>
      )}
      <Dialog
        open={confirming}
        title={`Remove ${profile.name}?`}
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void remove()}>
              Remove inverter
            </Button>
          </>
        }
      >
        EAM stops reading it. Its recorded history is kept.
      </Dialog>
    </form>
  );
}
