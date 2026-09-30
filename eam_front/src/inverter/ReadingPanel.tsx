import type { ReactNode } from 'react';
import { formatRegisterValue } from './format';
import type { LatestReading, RegisterDefinition } from './types';

/** Registers shown as large tiles, in this order. */
const KEY_REGISTERS = ['MainsVoltage', 'BatteryVoltage', 'PVPower', 'BatterySoc'];

interface Props {
  registers: RegisterDefinition[];
  reading: LatestReading;
  /** Rendered between the alerts and the full parameter grid. */
  children?: ReactNode;
}

/** Live values of one reading, labelled and formatted from the Register map. */
export default function ReadingPanel({ registers, reading, children }: Props) {
  const byName = new Map(registers.map((d) => [d.name, d]));
  const keyDefinitions = KEY_REGISTERS.flatMap((name) => byName.get(name) ?? []);
  const otherTelemetry = registers.filter(
    (d) => d.group === 'telemetry' && !KEY_REGISTERS.includes(d.name),
  );
  const faults = reading.alerts?.faults ?? [];
  const warnings = reading.alerts?.warnings ?? [];

  return (
    <>
      <section aria-label="Key metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {keyDefinitions.map((definition) => {
          const value = reading.payload[definition.name];
          return (
            <div
              key={definition.name}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            >
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{definition.label}</p>
              <p
                className={`mt-2 font-bold tracking-tight ${
                  typeof value === 'number'
                    ? 'text-3xl text-gray-900 dark:text-gray-50'
                    : 'text-xl text-gray-400 dark:text-gray-500'
                }`}
              >
                {formatRegisterValue(definition, value)}
              </p>
            </div>
          );
        })}
      </section>

      <section aria-label="Alerts" className="mt-4">
        {faults.length === 0 && warnings.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No active faults or warnings</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {faults.map((fault) => (
              <li
                key={`f-${fault}`}
                className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300"
              >
                {fault}
              </li>
            ))}
            {warnings.map((warning) => (
              <li
                key={`w-${warning}`}
                className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              >
                {warning}
              </li>
            ))}
          </ul>
        )}
      </section>

      {children}

      <section aria-label="All parameters" className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          All parameters ({otherTelemetry.length})
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {otherTelemetry.map((definition) => (
            <div
              key={definition.name}
              className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
            >
              <p className="truncate text-xs font-medium text-gray-500 dark:text-gray-400" title={definition.label}>
                {definition.label}
              </p>
              <p className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
                {formatRegisterValue(definition, reading.payload[definition.name])}
              </p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
