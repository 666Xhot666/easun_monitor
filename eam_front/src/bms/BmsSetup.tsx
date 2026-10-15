import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { formatAge } from '../energy/freshness';
import type { BmsDevice } from './types';
import { useBmsDevices } from './useBmsDevices';
import { Button, Segmented } from '../ui';
import { CopyButton } from '../ui/CopyButton';
import { Switch } from '../ui/Switch';
import { Dialog } from '../ui/Dialog';

const SOURCES: { value: BmsDevice['sourceType']; label: string }[] = [
  { value: 'mac-ble', label: 'bmsSetup.sources.mac-ble' },
  { value: 'esp32', label: 'bmsSetup.sources.esp32' },
];
const sourceLabel = (value: BmsDevice['sourceType']) =>
  i18n.t(SOURCES.find((s) => s.value === value)?.label ?? value);

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
  const { t } = useTranslation();
  const { devices, reload } = useBmsDevices(profileId);
  const [name, setName] = useState(() => i18n.t('bmsSetup.defaultName'));
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
    }, t('bmsSetup.addFailed'));
  };

  const replaceToken = (device: BmsDevice) => {
    void act(async () => {
      const { data } = await axios.post<{ token: string }>(
        `/api/inverter/profiles/${profileId}/bms/${device.id}/token`,
      );
      setToken(data.token);
    }, t('bmsSetup.tokenFailed'));
  };

  const setEnergyFlowSource = (device: BmsDevice, on: boolean) => {
    void act(async () => {
      await axios.patch(`/api/inverter/profiles/${profileId}/bms/${device.id}`, { useForEnergyFlow: on });
    }, t('bmsSetup.flowFailed'));
  };

  const remove = (device: BmsDevice) => {
    void act(async () => {
      await axios.delete(`/api/inverter/profiles/${profileId}/bms/${device.id}`);
    }, t('bmsSetup.removeFailed'));
  };

  const [asking, setAsking] = useState<{ kind: 'token' | 'remove'; device: BmsDevice } | null>(null);
  const ingest = token ? `BMS_INGEST_URL=${window.location.origin}/api/bms/ingest\nBMS_INGEST_TOKEN=${token}` : '';

  return (
    <section aria-label={t('bmsSetup.title')} className="space-y-4">
      <h2 className="sr-only">{t('bmsSetup.title')}</h2>
      {error && (
        <p role="alert" className="rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}
      {devices === null ? (
        <div className="h-24 animate-pulse rounded-xl border border-line bg-surface-2" />
      ) : devices.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-muted">{t('bmsSetup.none')}</p>
      ) : (
        <ul className="space-y-4">
          {devices.map((device) => (
            <li key={device.id} aria-label={device.name} className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
              <p className="flex flex-wrap items-center gap-2">
                <span className={'h-2 w-2 rounded-full ' + (device.lastSeenAt ? 'bg-good' : 'bg-idle')} />
                <span className="text-[15px] font-semibold">{device.name}</span>
                <span className="text-[13px] text-muted">
                  {sourceLabel(device.sourceType)} ·{' '}
                  {device.lastSeenAt ? t('bmsSetup.lastReading', { age: formatAge(now() - Date.parse(device.lastSeenAt)) }) : t('bmsSetup.noReading')}
                </span>
              </p>
              <label className="mt-3 flex items-center gap-3 text-sm">
                <Switch
                  label={t('bmsSetup.useForFlow', { name: device.name })}
                  on={device.useForEnergyFlow}
                  disabled={busy || readOnly}
                  onChange={(on) => setEnergyFlowSource(device, on)}
                />
                {t('bmsSetup.useOnOverview')}
              </label>
              {!readOnly && (
                <p className="mt-2 text-xs text-muted">
                  {t('bmsSetup.signHint')}
                </p>
              )}
              {!readOnly && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" aria-label={t('bmsSetup.newTokenFor', { name: device.name })} disabled={busy} onClick={() => setAsking({ kind: 'token', device })}>
                    {t('bmsSetup.newToken')}
                  </Button>
                  <button
                    type="button"
                    aria-label={t('bmsSetup.removeNamed', { name: device.name })}
                    disabled={busy}
                    onClick={() => setAsking({ kind: 'remove', device })}
                    className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-crit-ink hover:bg-crit-bg"
                  >
                    {t('bmsSetup.remove')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {token && (
        <section aria-label={t('bmsSetup.tokenTitle')} className="rounded-xl border border-warn-line bg-warn-bg p-4 text-sm text-warn-ink">
          <p>
            {t('bmsSetup.tokenIntro')}
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs text-ink">{ingest}</pre>
          <div className="mt-3 flex gap-2">
            <CopyButton text={ingest} />
            <Button size="sm" onClick={() => setToken(null)}>
              {t('common.done')}
            </Button>
          </div>
        </section>
      )}

      {!readOnly && (
        <form onSubmit={add} className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
          <h3 className="text-[15px] font-semibold">{t('bmsSetup.add')}</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              {t('bmsSetup.name')}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink"
              />
            </label>
            <div>
              <p className="text-sm font-medium">{t('bmsSetup.howRead')}</p>
              <div className="mt-1">
                <Segmented ariaLabel={t('bmsSetup.howRead')} options={SOURCES.map((s) => ({ ...s, label: t(s.label) }))} value={sourceType} onChange={setSourceType} />
              </div>
            </div>
          </div>
          <Button type="submit" variant="primary" className="mt-4" disabled={busy}>
            {t('bmsSetup.addButton')}
          </Button>
        </form>
      )}

      <Dialog
        open={asking !== null}
        title={asking?.kind === 'token' ? t('bmsSetup.tokenAsk', { name: asking.device.name }) : t('bmsSetup.removeAsk', { name: asking?.device.name })}
        onClose={() => setAsking(null)}
        actions={
          <>
            <Button onClick={() => setAsking(null)}>{t('common.cancel')}</Button>
            <Button
              variant={asking?.kind === 'remove' ? 'danger' : 'primary'}
              onClick={() => {
                const a = asking;
                setAsking(null);
                if (a?.kind === 'token') replaceToken(a.device);
                if (a?.kind === 'remove') remove(a.device);
              }}
            >
              {asking?.kind === 'token' ? t('bmsSetup.makeToken') : t('bmsSetup.remove')}
            </Button>
          </>
        }
      >
        {asking?.kind === 'token'
          ? t('bmsSetup.tokenWarning')
          : t('bmsSetup.removeWarning')}
      </Dialog>
    </section>
  );
}
