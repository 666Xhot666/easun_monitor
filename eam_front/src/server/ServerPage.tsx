import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { num, withUnit } from '../i18n/format';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import axios from '../lib/apiClient';
import { ageText, useNow } from '../shell/age';
import { PageHeader } from '../ui';
import { bytes, rate, uptime } from './format';
import FanPanel from './FanPanel';
import NoticesPanel from './NoticesPanel';
import ServerHistory from './ServerHistory';
import type { Battery, HostSample, ServerStatus, Usage } from './types';
import { STATUS_REFRESH_MS } from './constants';

const gb = (n: number) => `${num(n / 1e9, 1)} ${i18n.t('units.GB')}`;
const celsius = (n: number) => `${num(Math.round(n * 10) / 10, Number.isInteger(Math.round(n * 10) / 10) ? 0 : 1)} °C`;
/** A sensor's own label, or its device's name when the label is only a number. */
const sensorName = (t: HostSample['temperatures'][number]) => (/^temp\d+$/.test(t.label) ? t.device : t.label);

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

/** A filled bar for a share of 0–100 %. */
function Bar({ percent, label }: { percent: number; label: string }) {
  const tone = percent >= 90 ? 'bg-crit' : percent >= 75 ? 'bg-warn' : 'bg-good';
  return (
    <div role="meter" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} className="mt-1.5 h-2 rounded-full bg-surface-2">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

interface Props {
  /** Clock, fixed in tests. */
  now?: number;
}

/** The host the app runs on, as the server agent last reported it. Owner and viewers. */
export default function ServerPage({ now: fixedNow }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const tick = useNow(10_000);
  const now = fixedNow ?? tick;

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      axios
        .get<ServerStatus>('/api/server/status')
        .then(({ data }) => {
          if (!cancelled) {
            setStatus(data);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    void load();
    const timer = setInterval(() => void load(), STATUS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const sample = status?.sample ?? null;
  const age = sample ? now - Date.parse(sample.at) : 0;
  const header = (
    <PageHeader title={t('server.title')} subtitle={sample ? t('server.updatedAgo', { age: ageText(age) }) : t('server.subtitle')} />
  );

  if (failed && !status) {
    return (
      <>
        {header}
        <p role="alert" className="text-sm text-crit-ink">
          {t('server.loadFailed')}
        </p>
      </>
    );
  }
  if (!status) return <>{header}<div className="h-48 animate-pulse rounded-xl border border-line bg-surface-2" /></>;
  if (!sample) {
    return (
      <>
        {header}
        <p className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-muted">
          {user?.server === 'OWNER' ? (
            <>
              {t('server.noReportOwner')}{' '}
              <Link to="../settings/server-access" relative="path" className="underline">
                {t('server.settingsLink')}
              </Link>
              .
            </>
          ) : (
            t('server.notSetUp')
          )}
        </p>
      </>
    );
  }

  const { cpu, memory } = sample;
  const memoryUsed = memory.totalBytes - memory.availableBytes;
  const swapUsed = memory.swapTotalBytes - memory.swapFreeBytes;
  const hottest = sample.temperatures.reduce<number | null>((max, t) => (max === null || t.celsius > max ? t.celsius : max), null);

  return (
    <>
      {header}
      {status.stale && (
        <p role="alert" className="mb-4 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-ink">
          {t('server.stale', { age: ageText(age) })}
        </p>
      )}
      <div className={'grid gap-4 md:grid-cols-2 lg:grid-cols-3 ' + (status.stale ? 'opacity-80' : '')}>
        <Panel title={t('server.cpu')}>
          <p className="text-[26px] font-semibold tabular-nums">{cpu.usagePercent === null ? '—' : `${cpu.usagePercent} %`}</p>
          {cpu.usagePercent !== null && <Bar percent={cpu.usagePercent} label={t('server.cpuUse')} />}
          <p className="mt-2 text-muted">{t('server.load', { values: cpu.load.map((l) => num(l, 2)).join(' · ') })}</p>
          {cpu.coresPercent.length > 0 && (
            <p className="mt-1 text-xs text-muted">{t('server.cores', { values: cpu.coresPercent.map((c) => `${Math.round(c)} %`).join(' · ') })}</p>
          )}
        </Panel>

        <Panel title={t('server.temperatures')}>
          <p className="text-[26px] font-semibold tabular-nums">{hottest === null ? '—' : celsius(hottest)}</p>
          <ul className="mt-2 divide-y divide-line">
            {sample.temperatures.map((t) => (
              <li key={`${t.device}-${t.label}`} className="flex justify-between py-1">
                <span className="text-muted">{sensorName(t)}</span>
                <span className="tabular-nums">{celsius(t.celsius)}</span>
              </li>
            ))}
          </ul>
          {sample.temperatures.length === 0 && <p className="text-muted">{t('server.noSensors')}</p>}
        </Panel>

        <Panel title={t('server.fan')}>
          {sample.fans.length === 0 ? (
            <p className="text-muted">{t('server.noFan')}</p>
          ) : (
            sample.fans.map((f) => (
              <p key={`${f.device}-${f.label}`} className="text-[26px] font-semibold tabular-nums">
                {withUnit(f.rpm, 'rpm')}
              </p>
            ))
          )}
        </Panel>

        <Panel title={t('server.memory')}>
          <p>{t('server.used', { used: gb(memoryUsed), total: gb(memory.totalBytes) })}</p>
          {memory.totalBytes > 0 && <Bar percent={(memoryUsed / memory.totalBytes) * 100} label={t('server.memoryUse')} />}
          {memory.swapTotalBytes > 0 && (
            <p className="mt-2 text-muted">{t('server.swap', { used: gb(swapUsed), total: gb(memory.swapTotalBytes) })}</p>
          )}
        </Panel>

        <Panel title={t('server.storage')}>
          <ul className="space-y-3">
            {sample.disks.map((d) => (
              <li key={d.mount}>
                <p className="flex justify-between gap-2">
                  <span className="font-mono">{d.mount}</span>
                  <span>{t('server.free', { free: bytes(d.freeBytes), total: bytes(d.totalBytes) })}</span>
                </p>
                {d.totalBytes > 0 && <Bar percent={((d.totalBytes - d.freeBytes) / d.totalBytes) * 100} label={t('server.mountUsed', { mount: d.mount })} />}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t('server.network')}>
          <ul className="space-y-1">
            {sample.network.map((n) => (
              <li key={n.name} className="flex justify-between gap-2">
                <span className="font-mono">{n.name}</span>
                <span className="tabular-nums">
                  <span>↓ {rate(n.rxBytesPerSecond)}</span> <span>↑ {rate(n.txBytesPerSecond)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t('server.updates')}>
          <Updates updates={sample.updates ?? null} now={now} />
        </Panel>

        {sample.power && sample.power.batteries.length > 0 && (
          <Panel title={t('server.battery.title')}>
            <BatteryPanel onMains={sample.power.onMains} batteries={sample.power.batteries} />
          </Panel>
        )}

        <Panel title={t('server.system')}>
          <p>{t('server.up', { time: uptime(sample.uptimeSeconds) })}</p>
          {sample.services && sample.services.length > 0 && (
            <ul className="mt-2 divide-y divide-line">
              {sample.services.map((s) => (
                <li key={s.name} className="py-1">
                  <div className="flex justify-between">
                    <span className="font-mono text-xs">{s.name}</span>
                    <span className={s.active ? 'text-good-ink' : 'text-crit-ink'}>{t(s.active ? 'server.running' : 'server.stopped')}</span>
                  </div>
                  <UsageLine usage={s} />
                </li>
              ))}
            </ul>
          )}
          {sample.containers && sample.containers.length > 0 && (
            <ul className="mt-2 divide-y divide-line">
              {sample.containers.map((c) => (
                <li key={c.name} className="py-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-mono text-xs">{c.name}</span>
                    <span className={c.state === 'running' ? 'text-muted' : 'text-crit-ink'}>{c.status}</span>
                  </div>
                  <UsageLine usage={c} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <FanPanel owner={user?.server === 'OWNER'} />
      <NoticesPanel owner={user?.server === 'OWNER'} now={now} />
      <ServerHistory />
    </>
  );
}

/** "RAM 22 MB · CPU 0.6 % · disk 7.9 GB", leaving out what was not read; nothing when none was. */
function UsageLine({ usage }: { usage: Usage }) {
  const { t } = useTranslation();
  const parts = [
    usage.memoryBytes != null && t('server.usage.memory', { value: bytes(usage.memoryBytes) }),
    usage.cpuPercent != null && t('server.usage.cpu', { value: num(usage.cpuPercent, 1) }),
    usage.diskBytes != null && t('server.usage.disk', { value: bytes(usage.diskBytes) }),
  ].filter((p): p is string => typeof p === 'string');
  if (parts.length === 0) return null;
  return <p className="mt-0.5 text-xs text-muted">{parts.join(' · ')}</p>;
}

const STATUSES = ['Charging', 'Discharging', 'Full', 'Not charging'];

/** Whether the host runs on mains, and each battery's charge and health. */
function BatteryPanel({ onMains, batteries }: { onMains: boolean | null; batteries: Battery[] }) {
  const { t } = useTranslation();
  const wh = (n: number) => withUnit(n, 'Wh', Number.isInteger(n) ? 0 : 1);
  return (
    <>
      {onMains !== null && <p className={onMains ? '' : 'font-medium text-warn-ink'}>{t(onMains ? 'server.battery.onMains' : 'server.battery.onBattery')}</p>}
      <ul className="mt-1 divide-y divide-line">
        {batteries.map((b) => {
          const status = b.status && STATUSES.includes(b.status) ? t(`server.battery.status.${b.status}`) : b.status;
          const flow = b.powerW !== null && Math.abs(b.powerW) >= 0.1 && b.status !== 'Full' ? `, ${withUnit(Math.abs(b.powerW), 'W', 1)}` : '';
          return (
            <li key={b.name} className="py-1.5">
              <p>
                {b.percent !== null ? `${num(b.percent)} %` : b.name}
                {status && ` · ${status}${flow}`}
              </p>
              {b.healthPercent !== null && (
                <p className={b.healthPercent < 50 ? 'text-warn-ink' : 'text-muted'}>
                  {b.fullWh !== null && b.designWh !== null
                    ? t('server.battery.healthHolds', { percent: num(b.healthPercent), full: wh(b.fullWh), design: wh(b.designWh) })
                    : t('server.battery.health', { percent: num(b.healthPercent) })}
                </p>
              )}
              <p className="text-xs text-muted">
                {[b.model ?? b.name, b.voltageV !== null && withUnit(b.voltageV, 'V', 2), b.cycles !== null && t('server.battery.cycles', { count: b.cycles })]
                  .filter((p): p is string => typeof p === 'string')
                  .join(' · ')}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Updates({ updates, now }: { updates: HostSample['updates'] | null; now: number }) {
  const { t } = useTranslation();
  if (!updates) return <p className="text-muted">{t('server.notChecked')}</p>;
  const ago = (iso: string) => ageText(now - Date.parse(iso));
  return (
    <>
      {updates.rebootRequired && (
        <p className="mb-2 inline-block rounded-full bg-warn-bg px-2.5 py-0.5 text-xs font-medium text-warn-ink">{t('server.restartRequired')}</p>
      )}
      <p>
        {updates.packages === 0
          ? t('server.upToDate')
          : t('server.updatesAvailable', { count: updates.packages }) +
            (updates.security > 0 ? t('server.ofThemSecurity', { count: updates.security }) : '.')}
      </p>
      <p className="mt-1 text-xs text-muted">
        {t('server.checkedAgo', { age: ago(updates.checkedAt) })}{' '}
        {updates.listsUpdatedAt ? t('server.listsAgo', { age: ago(updates.listsUpdatedAt) }) : t('server.listsUnknown')}
      </p>
      {updates.names.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted">{t('server.packages')}</summary>
          <ul className="mt-1 columns-2 font-mono text-xs">
            {updates.names.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
