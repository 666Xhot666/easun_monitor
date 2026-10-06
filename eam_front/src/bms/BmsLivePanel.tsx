import type { BmsLatest, BmsReading } from './types';
import { formatAge } from '../energy/freshness';

interface BmsLivePanelProps {
  latest: BmsLatest | null;
}

function cellExtreme(reading: BmsReading, cellNumber: number): 'min' | 'max' | undefined {
  if (reading.cellMinIndex === cellNumber) {
    return 'min';
  }
  if (reading.cellMaxIndex === cellNumber) {
    return 'max';
  }
  return undefined;
}

function cellBarClass(reading: BmsReading, cellNumber: number): string {
  const extreme = cellExtreme(reading, cellNumber);
  if (extreme === 'min') {
    return 'h-full bg-blue-500 dark:bg-blue-400';
  }
  if (extreme === 'max') {
    return 'h-full bg-red-500 dark:bg-red-400';
  }
  return 'h-full bg-gray-300 dark:bg-gray-600';
}

function cellWidthPct(v: number): number {
  const min = 2.5;
  const max = 3.65;
  const pct = ((v - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, pct));
}

function cellWidthStyle(v: number): { width: string } {
  return { width: `${cellWidthPct(v)}%` };
}

function balancingText(reading: BmsReading): string {
  if (reading.balancing === true) {
    if (reading.balanceCurrentA === null) {
      return 'Balancing';
    }
    return `Balancing (${reading.balanceCurrentA.toFixed(2)} A)`;
  }
  if (reading.balancing === false) {
    return 'Idle';
  }
  return '--';
}

function mosfetText(on: boolean | null, label: string): string {
  if (on === true) {
    return `${label} on`;
  }
  if (on === false) {
    return `${label} off`;
  }
  return `${label} --`;
}

function valueSectionsClass(stale: boolean): string {
  return stale ? 'space-y-4 opacity-60' : 'space-y-4';
}

/** The BMS's latest reading: charge, pack, every cell, temperatures, status and alarms; never a stale reading as current. */
export default function BmsLivePanel({ latest }: BmsLivePanelProps) {
  if (latest === null) {
    return (
      <p role="status" className="text-gray-600 dark:text-gray-300">
        No reading from the BMS yet. Start the BMS reader and check its token.
      </p>
    );
  }

  const { reading, ageSeconds, status } = latest;
  const stale = status === 'stale';
  const chargeLabel = 'Charge';
  const dischargeLabel = 'Discharge';

  const soc = reading.stateOfChargePct === null ? '--' : `${Math.round(reading.stateOfChargePct)}%`;
  const voltage = reading.packVoltageV === null ? '--' : `${reading.packVoltageV.toFixed(2)} V`;
  const current = reading.currentA === null ? '--' : `${reading.currentA.toFixed(2)} A`;
  const power = reading.powerW === null ? '--' : `${Math.round(reading.powerW)} W`;

  const capacityLine =
    reading.remainingCapacityAh === null ||
    reading.nominalCapacityAh === null ||
    reading.cycleCount === null
      ? null
      : `${reading.remainingCapacityAh} of ${reading.nominalCapacityAh} Ah · ${reading.cycleCount} cycles`;

  return (
    <div data-testid="bms-panel" data-stale={String(stale)} className="space-y-4">
      {stale ? (
        <p role="status" className="text-amber-600 dark:text-amber-400">
          Last reading {formatAge(ageSeconds * 1000)} ago, not current
        </p>
      ) : null}

      <div className={valueSectionsClass(stale)}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs text-gray-500 dark:text-gray-400">State of charge</p>
            <p data-testid="bms-soc" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {soc}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs text-gray-500 dark:text-gray-400">Pack voltage</p>
            <p data-testid="bms-voltage" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {voltage}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs text-gray-500 dark:text-gray-400">Current</p>
            <p data-testid="bms-current" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {current}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
            <p className="text-xs text-gray-500 dark:text-gray-400">Power</p>
            <p data-testid="bms-power" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {power}
            </p>
          </div>
        </div>

        {capacityLine !== null ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">{capacityLine}</p>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Cells</h2>
          <ul aria-label="Cell voltages" className="space-y-1">
            {reading.cellVoltagesV.map((v, i) => {
              const n = i + 1;
              const extreme = cellExtreme(reading, n);
              return (
                <li
                  key={n}
                  data-extreme={extreme}
                  className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                >
                  <span className="w-12 shrink-0">Cell {n}</span>
                  <span className="w-16 shrink-0">{v.toFixed(3)} V</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                    <div className={cellBarClass(reading, n)} style={cellWidthStyle(v)} />
                  </div>
                </li>
              );
            })}
          </ul>
          {reading.cellDeltaV !== null ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Spread {Math.round(reading.cellDeltaV * 1000)} mV
            </p>
          ) : null}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Temperatures</h2>
          <div className="flex flex-wrap gap-3">
            {reading.temperaturesC.map((t) => (
              <div key={t.name} className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                <span>{t.name}</span>
                <span>{t.celsius.toFixed(1)} °C</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Status</h2>
          <div className="flex flex-wrap gap-3 text-sm text-gray-700 dark:text-gray-300">
            <p data-testid="bms-balancing">{balancingText(reading)}</p>
            <p data-testid="bms-charge-mosfet">{mosfetText(reading.chargeMosfetOn, chargeLabel)}</p>
            <p data-testid="bms-discharge-mosfet">{mosfetText(reading.dischargeMosfetOn, dischargeLabel)}</p>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Alarms</h2>
          {reading.alarms.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">No alarms</p>
          ) : (
            <ul aria-label="Alarms" className="space-y-1">
              {reading.alarms.map((alarm) => (
                <li key={alarm} className="text-sm text-red-600 dark:text-red-400">
                  {alarm}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
