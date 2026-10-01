import { useState } from 'react';
import { proposeLithiumSettings, type BmsLimits } from './lithiumSetup';

const FIELDS: { key: keyof BmsLimits; label: string }[] = [
  { key: 'maxChargingVoltage', label: 'BMS max charging voltage (V)' },
  { key: 'maxChargingCurrent', label: 'BMS max charging current (A)' },
  { key: 'dischargeProtectionVoltage', label: 'BMS discharge protection voltage (V)' },
];

/**
 * The manual's setup for a lithium battery without BMS communication: asks
 * for the BMS limits and hands back proposed settings, which the page shows
 * as unsaved edits for the user to review and save.
 */
export default function LithiumSetupHelper({ onPropose }: { onPropose: (settings: Record<string, number>) => void }) {
  const [open, setOpen] = useState(false);
  const [limits, setLimits] = useState<Record<keyof BmsLimits, string>>({
    maxChargingVoltage: '',
    maxChargingCurrent: '',
    dischargeProtectionVoltage: '',
  });
  const numbers = FIELDS.map(({ key }) => Number(limits[key]));
  const complete = FIELDS.every(({ key }) => limits[key].trim() !== '') && numbers.every((n) => n > 0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        Set up a lithium battery without BMS communication
      </button>
    );
  }

  return (
    <section
      aria-label="Lithium battery setup"
      className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900"
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Enter the limits from your battery's BMS specification. The proposed values follow the inverter manual and
        appear below as unsaved changes. The panel's battery type (program 05) must be Lithium or User-Defined for them
        to apply; the manual advises changing them with the inverter output off and restarting it afterwards.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {FIELDS.map(({ key, label }) => (
          <label key={key} className="flex flex-col text-xs text-gray-600 dark:text-gray-300">
            {label}
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={limits[key]}
              onChange={(e) => setLimits((l) => ({ ...l, [key]: e.target.value }))}
              className="mt-1 w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
          </label>
        ))}
        <button
          type="button"
          disabled={!complete}
          onClick={() => {
            const [maxChargingVoltage, maxChargingCurrent, dischargeProtectionVoltage] = numbers;
            onPropose(proposeLithiumSettings({ maxChargingVoltage, maxChargingCurrent, dischargeProtectionVoltage }));
          }}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          Fill in proposed values
        </button>
      </div>
    </section>
  );
}
