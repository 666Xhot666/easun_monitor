import type { ReactNode } from 'react';
import { alarmName } from './alarmName';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { num, unit, withUnit } from '../i18n/format';
import { Link } from 'react-router-dom';
import type { BmsLatest, BmsReading } from './types';
import { formatAge } from '../energy/freshness';
import { batteryEta, formatDuration } from '../energy/overviewModel';
import { CELL_MAX_V, CELL_MIN_V, IDLE_A } from './constants';

interface BmsLivePanelProps {
  latest: BmsLatest | null;
  /** Where "Battery monitor settings" leads; left out for readers. */
  settingsHref?: string;
}

const card = 'rounded-xl border border-line bg-surface p-4 sm:p-[18px]';

function cellExtreme(reading: BmsReading, cellNumber: number): 'min' | 'max' | undefined {
  if (reading.cellMinIndex === cellNumber) return 'min';
  if (reading.cellMaxIndex === cellNumber) return 'max';
  return undefined;
}

const cellPct = (v: number) => Math.min(100, Math.max(0, ((v - CELL_MIN_V) / (CELL_MAX_V - CELL_MIN_V)) * 100));

function Stat({ testId, label, value, sub }: { testId: string; label: string; value: string; sub?: string }) {
  return (
    <div data-testid={testId}>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

function StatusRow({ on, label, value, testId }: { on: boolean | null; label: string; value: ReactNode; testId: string }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-line py-2.5 first:border-t-0">
      <span className={'h-2 w-2 rounded-full ' + (on ? 'bg-good' : 'bg-idle')} />
      <span className="flex-1">{label}</span>
      <span data-testid={testId} className="font-semibold">
        {value}
      </span>
    </div>
  );
}

/** The BMS's latest reading: charge, pack, every cell, temperatures, status and alarms; never a stale reading as current. */
export default function BmsLivePanel({ latest, settingsHref }: BmsLivePanelProps) {
  const { t } = useTranslation();
  if (latest == null) {
    return (
      <p role="status" className={card + ' text-sm text-muted'}>
        {t('battery.noReading')}
      </p>
    );
  }

  const { reading, ageSeconds, status } = latest;
  const stale = status === 'stale';
  const current = reading.currentA;
  const direction = current == null || Math.abs(current) < IDLE_A ? 'idle' : current > 0 ? 'charging' : 'discharging';
  const eta = batteryEta(reading);
  const soc = reading.stateOfChargePct;
  const cells = reading.cellVoltagesV;
  const fmtV = (v: number | null) => (v == null ? '--' : withUnit(v, 'V', 3));

  return (
    <div data-testid="bms-panel" data-stale={String(stale)} className="space-y-4">
      {stale && (
        <p role="status" className="rounded-lg border border-warn-line bg-warn-bg px-4 py-2.5 text-sm text-warn-ink">
          {t('battery.staleReading', { age: formatAge(ageSeconds * 1000) })}
        </p>
      )}
      <div className={stale ? 'space-y-4 opacity-60' : 'space-y-4'}>
        <section className={card}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-[15px] font-semibold">{t('battery.pack')}</h2>
            <span className="text-xs text-muted">
              {cells.length}S{reading.nominalCapacityAh !== null ? ` · ${withUnit(reading.nominalCapacityAh, 'Ah')}` : ''}
            </span>
            {!stale && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                {t('battery.live', { age: formatAge(ageSeconds * 1000) })}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span data-testid="bms-soc" className="text-[52px] leading-none font-semibold tracking-tight tabular-nums">
              {soc == null ? '--' : `${Math.round(soc)}%`}
            </span>
            <span className={'text-[15px] font-semibold ' + (direction === 'charging' ? 'text-good-ink' : '')}>{t(`battery.${direction}`)}</span>
            {eta && (
              <span className="text-sm text-muted">
                {t(eta.kind === 'full' ? 'battery.etaFull' : 'battery.etaEmpty', { time: formatDuration(eta.hours) })}
              </span>
            )}
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-batt" style={{ width: `${soc ?? 0}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-5">
            <Stat testId="bms-voltage" label={t('battery.packVoltage')} value={reading.packVoltageV == null ? '--' : withUnit(reading.packVoltageV, 'V', 2)} />
            <Stat
              testId="bms-current"
              label={t('battery.current')}
              value={current == null ? '--' : `${current > 0 ? '+' : ''}${withUnit(current, 'A', 2)}`}
              sub={current == null || direction === 'idle' ? undefined : t(current > 0 ? 'battery.intoPack' : 'battery.outOfPack')}
            />
            <Stat
              testId="bms-power"
              label={t('battery.power')}
              value={reading.powerW == null ? '--' : withUnit(Math.abs(Math.round(reading.powerW)), 'W')}
              sub={reading.powerW == null || direction === 'idle' ? undefined : t(`battery.${direction}`).toLowerCase()}
            />
            <Stat
              testId="bms-remaining"
              label={t('battery.remaining')}
              value={reading.remainingCapacityAh == null ? '--' : `${reading.remainingCapacityAh} ${unit('Ah')}`}
              sub={reading.nominalCapacityAh == null ? undefined : t('battery.ofCapacity', { capacity: `${reading.nominalCapacityAh} ${unit('Ah')}` })}
            />
            <Stat testId="bms-cycles" label={t('battery.cycles')} value={reading.cycleCount == null ? '--' : String(reading.cycleCount)} />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className={card + ' lg:col-span-2'}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold">{t('battery.cells')}</h2>
              {reading.cellDeltaV !== null && (
                <span className="rounded-full bg-good-bg px-2 py-0.5 text-xs font-medium text-good-ink">
                  {t('battery.spread', { mv: Math.round(reading.cellDeltaV * 1000) })}
                </span>
              )}
              <span className="ml-auto text-xs text-muted">
                {t('battery.scale', { min: num(CELL_MIN_V, 2), max: withUnit(CELL_MAX_V, 'V', 2) })}
              </span>
            </div>
            <ul aria-label={t('battery.cellVoltages')} className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
              {cells.map((v, i) => {
                const n = i + 1;
                const extreme = cellExtreme(reading, n);
                const diff = reading.cellAverageV == null ? null : Math.round((v - reading.cellAverageV) * 1000);
                return (
                  <li
                    key={n}
                    aria-label={t('battery.cell', { n, voltage: withUnit(v, 'V', 3) })}
                    data-extreme={extreme}
                    className={
                      'flex flex-col gap-0.5 rounded-lg bg-surface-2 px-2 pt-1.5 pb-1 ' + (extreme ? 'ring-1 ring-line-strong' : '')
                    }
                  >
                    <span className="flex justify-between text-[11px] text-muted">
                      C{n}
                      {extreme && <span className="font-semibold text-ink">{t(extreme === 'min' ? 'battery.low' : 'battery.high')}</span>}
                    </span>
                    <span className="text-[15px] font-semibold tabular-nums">{num(v, 3)}</span>
                    {diff !== null && (
                      <span className="text-[11px] text-muted tabular-nums">
                        {diff > 0 ? '+' : diff < 0 ? '−' : '±'}
                        {Math.abs(diff)} mV
                      </span>
                    )}
                    <span className="mt-1 h-[3px] overflow-hidden rounded bg-line">
                      <span className="block h-full bg-batt" style={{ width: `${cellPct(v)}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
              <span>
                {t('battery.min')} <b className="text-ink">{fmtV(reading.cellMinV)}{reading.cellMinIndex ? ` · C${reading.cellMinIndex}` : ''}</b>
              </span>
              <span>
                {t('battery.avg')} <b className="text-ink">{fmtV(reading.cellAverageV)}</b>
              </span>
              <span>
                {t('battery.max')} <b className="text-ink">{fmtV(reading.cellMaxV)}{reading.cellMaxIndex ? ` · C${reading.cellMaxIndex}` : ''}</b>
              </span>
            </p>
          </section>

          <section className={card + ' flex flex-col text-[15px]'}>
            <h2 className="mb-2 text-[15px] font-semibold">{t('battery.status')}</h2>
            <StatusRow
              testId="bms-balancing"
              on={reading.balancing}
              label={t('battery.balancing')}
              value={
                reading.balancing === true
                  ? reading.balanceCurrentA == null
                    ? t('battery.balancing')
                    : t('battery.balancingAt', { current: withUnit(reading.balanceCurrentA, 'A', 2) })
                  : reading.balancing === false
                    ? t('battery.idle')
                    : '--'
              }
            />
            <StatusRow testId="bms-charge-mosfet" on={reading.chargeMosfetOn} label={t('battery.chargeMosfet')} value={onOff(reading.chargeMosfetOn)} />
            <StatusRow
              testId="bms-discharge-mosfet"
              on={reading.dischargeMosfetOn}
              label={t('battery.dischargeMosfet')}
              value={onOff(reading.dischargeMosfetOn)}
            />
            <p className="mt-3 text-xs text-muted">{t('battery.temperatures')}</p>
            {reading.temperaturesC.map((temp) => (
              <p key={temp.name} className="flex justify-between py-0.5">
                <span>{temp.name}</span>
                <span className="font-semibold tabular-nums">{num(temp.celsius, 1)} °C</span>
              </p>
            ))}
            <p className="mt-3 text-xs text-muted">{t('battery.alarms')}</p>
            {reading.alarms.length === 0 ? (
              <p>{t('battery.noAlarms')}</p>
            ) : (
              <ul aria-label={t('battery.alarms')} className="flex flex-col gap-1">
                {reading.alarms.map((alarm) => (
                  <li key={alarm} className="text-crit-ink">
                    {alarmName(alarm)}
                  </li>
                ))}
              </ul>
            )}
            {settingsHref && (
              <Link
                to={settingsHref}
                className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-line-strong text-sm font-medium hover:bg-surface-2"
              >
                {t('battery.settings')}
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const onOff = (on: boolean | null) => (on === true ? i18n.t('battery.on') : on === false ? i18n.t('battery.off') : '--');
