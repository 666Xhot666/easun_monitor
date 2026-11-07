import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import { withUnit } from '../i18n/format';
import { CELL_LOW_ABOVE_RECOVERY_V } from './constants';
import type { BmsDevice } from './types';
import { useBmsSettings } from './useBmsSettings';

/**
 * A BMS device's low-cell alert voltage: empty for the default, a little above the BMS's own undervoltage recovery.
 */
interface Props {
  profileId: number;
  device: BmsDevice;
  disabled: boolean;
  onSave: (cellLowAlertV: number | null) => void;
}

export default function CellLowAlertField({ profileId, device, disabled, onSave }: Props) {
  const { t } = useTranslation();
  const report = useBmsSettings(profileId, device.id);
  const recovery = report?.settings?.cellUndervoltageRecoveryV;
  const [value, setValue] = useState(device.cellLowAlertV === null ? '' : String(device.cellLowAlertV));
  const id = `cell-low-${device.id}`;
  const parsed = value.trim() === '' ? null : Number(value);
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 2 && parsed <= 4.5);

  return (
    <div className="mt-3">
      <label htmlFor={id} className="text-sm font-medium">
        {t('bmsSetup.cellLow')}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={id}
          type="number"
          step={0.01}
          min={2}
          max={4.5}
          className="h-10 w-28 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button size="sm" disabled={disabled || !valid} onClick={() => onSave(parsed)}>
          {t('bmsSetup.saveCellLow')}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {typeof recovery === 'number'
          ? t('bmsSetup.cellLowDefault', {
              default: withUnit(recovery + CELL_LOW_ABOVE_RECOVERY_V, 'V', 2),
              margin: withUnit(CELL_LOW_ABOVE_RECOVERY_V, 'V', 1),
              recovery: withUnit(recovery, 'V', 2),
            })
          : t('bmsSetup.cellLowNone')}
      </p>
    </div>
  );
}
