import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { proposeLithiumSettings, type BmsLimits } from './lithiumSetup';

const FIELDS: { key: keyof BmsLimits }[] = [
  { key: 'maxChargingVoltage' },
  { key: 'maxChargingCurrent' },
  { key: 'dischargeProtectionVoltage' },
];

/**
 * The manual's setup for a lithium battery without BMS communication: asks
 * for the BMS limits and hands back proposed settings, which the page shows
 * as unsaved edits for the user to review and save.
 */
export default function LithiumSetupHelper({ onPropose }: { onPropose: (settings: Record<string, number>) => void }) {
  const { t } = useTranslation();
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
        className="text-sm font-medium text-accent hover:underline"
      >
        {t('lithium.open')}
      </button>
    );
  }

  return (
    <section
      aria-label={t('lithium.label')}
      className="rounded-xl border border-line bg-surface px-4 py-3.5"
    >
      <p className="text-sm leading-relaxed text-muted">
        {t('lithium.intro')}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {FIELDS.map(({ key }) => (
          <label key={key} className="flex flex-col text-xs text-muted">
            {t(`lithium.${key}`)}
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={limits[key]}
              onChange={(e) => setLimits((l) => ({ ...l, [key]: e.target.value }))}
              className="mt-1 h-[38px] w-40 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink"
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
          className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-page transition hover:opacity-90 disabled:opacity-50"
        >
          {t('lithium.fill')}
        </button>
      </div>
    </section>
  );
}
