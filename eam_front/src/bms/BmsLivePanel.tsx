import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { BmsLatest, BmsReading } from './types';
import { formatAge } from '../energy/freshness';
import { batteryEta, formatDuration } from '../energy/overviewModel';

interface BmsLivePanelProps {
  latest: BmsLatest | null;
  /** Where "Battery monitor settings" leads; left out for readers. */
  settingsHref?: string;
}

/** Bar scale for a LiFePO4 cell: empty to full. */
const CELL_MIN_V = 2.5;
const CELL_MAX_V = 3.65;
const IDLE_A = 0.5;

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
  if (latest == null) {
    return (
      <p role="status" className={card + ' text-sm text-muted'}>
        No reading from the BMS yet. Start the BMS reader and check its token.
      </p>
    );
  }

  const { reading, ageSeconds, status } = latest;
  const stale = status === 'stale';
  const current = reading.currentA;
  const direction = current == null || Math.abs(current) < IDLE_A ? 'Idle' : current > 0 ? 'Charging' : 'Discharging';
  const eta = batteryEta(reading);
  const soc = reading.stateOfChargePct;
  const cells = reading.cellVoltagesV;
  const fmtV = (v: number | null) => (v == null ? '--' : `${v.toFixed(3)} V`);

  return (
    <div data-testid="bms-panel" data-stale={String(stale)} className="space-y-4">
      {stale && (
        <p role="status" className="rounded-lg border border-warn-line bg-warn-bg px-4 py-2.5 text-sm text-warn-ink">
          Last reading {formatAge(ageSeconds * 1000)} ago, not current
        </p>
      )}
      <div className={stale ? 'space-y-4 opacity-60' : 'space-y-4'}>
        <section className={card}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-[15px] font-semibold">Pack</h2>
            <span className="text-xs text-muted">
              {cells.length}S{reading.nominalCapacityAh !== null ? ` · ${reading.nominalCapacityAh} Ah` : ''}
            </span>
            {!stale && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                Live · {formatAge(ageSeconds * 1000)} ago
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span data-testid="bms-soc" className="text-[52px] leading-none font-semibold tracking-tight tabular-nums">
              {soc == null ? '--' : `${Math.round(soc)}%`}
            </span>
            <span className={'text-[15px] font-semibold ' + (direction === 'Charging' ? 'text-good-ink' : '')}>{direction}</span>
            {eta && (
              <span className="text-sm text-muted">
                {eta.kind === 'full' ? 'Full' : 'Empty'} in {formatDuration(eta.hours)} at the current rate
              </span>
            )}
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-batt" style={{ width: `${soc ?? 0}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-5">
            <Stat testId="bms-voltage" label="Pack voltage" value={reading.packVoltageV == null ? '--' : `${reading.packVoltageV.toFixed(2)} V`} />
            <Stat
              testId="bms-current"
              label="Current"
              value={current == null ? '--' : `${current > 0 ? '+' : ''}${current.toFixed(2)} A`}
              sub={current == null || direction === 'Idle' ? undefined : current > 0 ? 'into the pack' : 'out of the pack'}
            />
            <Stat
              testId="bms-power"
              label="Power"
              value={reading.powerW == null ? '--' : `${Math.abs(Math.round(reading.powerW)).toLocaleString('en-US')} W`}
              sub={reading.powerW == null || direction === 'Idle' ? undefined : direction.toLowerCase()}
            />
            <Stat
              testId="bms-remaining"
              label="Remaining"
              value={reading.remainingCapacityAh == null ? '--' : `${reading.remainingCapacityAh} Ah`}
              sub={reading.nominalCapacityAh == null ? undefined : `of ${reading.nominalCapacityAh} Ah`}
            />
            <Stat testId="bms-cycles" label="Cycles" value={reading.cycleCount == null ? '--' : String(reading.cycleCount)} />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className={card + ' lg:col-span-2'}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold">Cells</h2>
              {reading.cellDeltaV !== null && (
                <span className="rounded-full bg-good-bg px-2 py-0.5 text-xs font-medium text-good-ink">
                  Spread {Math.round(reading.cellDeltaV * 1000)} mV
                </span>
              )}
              <span className="ml-auto text-xs text-muted">
                Scale {CELL_MIN_V.toFixed(2)}–{CELL_MAX_V.toFixed(2)} V · LiFePO4
              </span>
            </div>
            <ul aria-label="Cell voltages" className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
              {cells.map((v, i) => {
                const n = i + 1;
                const extreme = cellExtreme(reading, n);
                const diff = reading.cellAverageV == null ? null : Math.round((v - reading.cellAverageV) * 1000);
                return (
                  <li
                    key={n}
                    aria-label={`Cell ${n}: ${v.toFixed(3)} V`}
                    data-extreme={extreme}
                    className={
                      'flex flex-col gap-0.5 rounded-lg bg-surface-2 px-2 pt-1.5 pb-1 ' + (extreme ? 'ring-1 ring-line-strong' : '')
                    }
                  >
                    <span className="flex justify-between text-[11px] text-muted">
                      C{n}
                      {extreme && <span className="font-semibold text-ink">{extreme === 'min' ? 'Low' : 'High'}</span>}
                    </span>
                    <span className="text-[15px] font-semibold tabular-nums">{v.toFixed(3)}</span>
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
                Min <b className="text-ink">{fmtV(reading.cellMinV)}{reading.cellMinIndex ? ` · C${reading.cellMinIndex}` : ''}</b>
              </span>
              <span>
                Avg <b className="text-ink">{fmtV(reading.cellAverageV)}</b>
              </span>
              <span>
                Max <b className="text-ink">{fmtV(reading.cellMaxV)}{reading.cellMaxIndex ? ` · C${reading.cellMaxIndex}` : ''}</b>
              </span>
            </p>
          </section>

          <section className={card + ' flex flex-col text-[15px]'}>
            <h2 className="mb-2 text-[15px] font-semibold">Status</h2>
            <StatusRow
              testId="bms-balancing"
              on={reading.balancing}
              label="Balancing"
              value={
                reading.balancing === true
                  ? reading.balanceCurrentA == null
                    ? 'Balancing'
                    : `Balancing (${reading.balanceCurrentA.toFixed(2)} A)`
                  : reading.balancing === false
                    ? 'Idle'
                    : '--'
              }
            />
            <StatusRow testId="bms-charge-mosfet" on={reading.chargeMosfetOn} label="Charge MOSFET" value={onOff(reading.chargeMosfetOn)} />
            <StatusRow
              testId="bms-discharge-mosfet"
              on={reading.dischargeMosfetOn}
              label="Discharge MOSFET"
              value={onOff(reading.dischargeMosfetOn)}
            />
            <p className="mt-3 text-xs text-muted">Temperatures</p>
            {reading.temperaturesC.map((t) => (
              <p key={t.name} className="flex justify-between py-0.5">
                <span>{t.name}</span>
                <span className="font-semibold tabular-nums">{t.celsius.toFixed(1)} °C</span>
              </p>
            ))}
            <p className="mt-3 text-xs text-muted">Alarms</p>
            {reading.alarms.length === 0 ? (
              <p>No alarms</p>
            ) : (
              <ul aria-label="Alarms" className="flex flex-col gap-1">
                {reading.alarms.map((alarm) => (
                  <li key={alarm} className="text-crit-ink">
                    {alarm}
                  </li>
                ))}
              </ul>
            )}
            {settingsHref && (
              <Link
                to={settingsHref}
                className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-line-strong text-sm font-medium hover:bg-surface-2"
              >
                Battery monitor settings
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const onOff = (on: boolean | null) => (on === true ? 'On' : on === false ? 'Off' : '--');
