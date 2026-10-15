import type { BmsReading } from '../bms/reading';
import { LOCALES, type Language } from '../i18n/languages';
import { translate } from '../i18n/translate';
import { registerMapFor } from '../inverter/registers/register-translations';
import type { EnergyTotals } from '../telemetry/telemetry.store';

/** Escape characters that Telegram HTML treats as markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOrZero(value: unknown): number {
  return isNumber(value) ? value : 0;
}

/** The card texts and number format of one language. */
function wording(language: Language) {
  const t = (key: string, values?: Record<string, string | number>) =>
    translate(language, key, values);
  const card = (key: string) => t(`telegram.card.${key}`);
  const unit = (key: string) => t(`units.${key}`);
  /** `value` with exactly `decimals` decimals, without thousands separators. */
  const fixed = (value: number, decimals: number) =>
    new Intl.NumberFormat(LOCALES[language], {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    }).format(value);
  const watts = (value: unknown) => {
    if (!isNumber(value)) return '--';
    if (Math.abs(value) >= 1000)
      return `${fixed(value / 1000, 2)} ${unit('kW')}`;
    return `${Math.round(value)} ${unit('W')}`;
  };
  const kWhValue = (value: unknown) => {
    const v = numberOrZero(value);
    return fixed(v, v < 10 ? 2 : 1);
  };
  const kWh = (value: unknown) => `${kWhValue(value)} ${unit('kWh')}`;
  const map = registerMapFor(language);
  const modeName = (value: unknown) => {
    if (!isNumber(value)) return undefined;
    const option = map.get('OperationMode')?.options?.[value];
    return typeof option === 'string' && option.length > 0 ? option : undefined;
  };
  const ago = (key: string, count: number) => t(`units.${key}`, { count });
  return { t, card, unit, fixed, watts, kWhValue, kWh, map, modeName, ago };
}

/** A BMS alarm's name in `language` (the BMS gives it in English). */
export function bmsAlarmName(alarm: string, language: Language): string {
  return translate(language, `bmsAlarms.${alarm}`).replace(/^bmsAlarms\./, '');
}

/** Format the inverter status as a Telegram HTML card. */
export function statusCard(
  name: string,
  reading: { timestamp: Date; payload: Record<string, number> } | null,
  now: Date,
  language: Language,
): string {
  const { card, unit, watts, modeName, ago } = wording(language);
  const header = '<b>🏠 ' + escapeHtml(name) + '</b>';
  if (!reading) {
    return header + '\n' + card('noReadings');
  }

  const payload = reading.payload;
  const mode = modeName(payload['OperationMode']);
  const lines: string[] = [mode ? header + ' · ' + escapeHtml(mode) : header];

  lines.push(`☀️ ${card('pv')} <b>${watts(payload['PVPower'])}</b>`);
  lines.push(
    `🏡 ${card('load')} <b>${watts(payload['OutputActivePower'])}</b>`,
  );

  let grid = `🔌 ${card('grid')} <b>${watts(payload['AverageMainsPower'])}</b>`;
  const mainsVoltage = payload['MainsVoltage'];
  if (isNumber(mainsVoltage) && mainsVoltage <= 100) {
    grid += ' · ' + card('noGrid');
  }
  lines.push(grid);

  const soc = payload['BatterySoc'];
  if (isNumber(soc)) {
    let battery = `🔋 ${card('battery')} <b>${Math.round(soc)} %</b>`;
    const voltage = payload['BatteryVoltage'];
    const current = payload['BatteryCurrentSigned'];
    if (isNumber(voltage) && isNumber(current)) {
      const power = voltage * current;
      if (Math.abs(power) <= 10) {
        battery += ' · ' + card('idle');
      } else {
        battery +=
          ' · ' +
          card(power < 0 ? 'discharging' : 'charging') +
          ' ' +
          watts(Math.abs(power));
      }
    }
    lines.push(battery);
  }

  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - reading.timestamp.getTime()) / 60000),
  );
  const age =
    minutes < 1
      ? unit('justNow')
      : minutes < 60
        ? ago('minutesAgo', minutes)
        : ago('hoursAgo', Math.floor(minutes / 60));
  lines.push(
    '<i>' + translate(language, 'telegram.card.readingAge', { age }) + '</i>',
  );
  return lines.join('\n');
}

/** Format today's energy totals as a Telegram HTML card. */
export function energyCard(
  name: string,
  totals: EnergyTotals,
  language: Language,
): string {
  const { card, unit, kWh, kWhValue } = wording(language);
  const lines: string[] = [
    `<b>⚡ ${escapeHtml(name)} · ${card('today')}</b>`,
    `☀️ ${card('pv')} <b>${kWh(totals.pvKWh)}</b>`,
    `🔌 ${card('grid')} <b>${kWh(totals.gridKWh)}</b>`,
    `🏡 ${card('load')} <b>${kWh(totals.outputKWh)}</b>`,
    `🔋 ${card('battery')} <b>+${kWhValue(totals.batteryChargeKWh)}</b> ${card('charged')} · ` +
      `<b>-${kWhValue(totals.batteryDischargeKWh)} ${unit('kWh')}</b> ${card('used')}`,
  ];
  return lines.join('\n');
}

/** Format the inverter and BMS battery views as a Telegram HTML card. */
export function batteryCard(
  name: string,
  payload: Record<string, number> | null,
  devices: { name: string; reading: BmsReading }[],
  now: Date,
  language: Language,
): string {
  const { card, unit, fixed, ago } = wording(language);
  const lines: string[] = ['<b>🔋 ' + escapeHtml(name) + '</b>'];

  const soc = payload?.['BatterySoc'];
  if (!isNumber(soc)) {
    lines.push(`${card('inverter')}: ${card('noReading')}`);
  } else {
    let inverter = `${card('inverter')}: <b>${Math.round(soc)} %</b>`;
    const voltage = payload?.['BatteryVoltage'];
    if (isNumber(voltage)) {
      inverter += ` · ${fixed(voltage, 2)} ${unit('V')}`;
    }
    const current = payload?.['BatteryCurrentSigned'];
    if (isNumber(current)) {
      inverter += ` · ${fixed(current, 1)} ${unit('A')}`;
    }
    lines.push(inverter);
  }

  lines.push('');

  if (devices.length === 0) {
    lines.push(card('noBms'));
  } else {
    devices.forEach((device, index) => {
      if (index > 0) {
        lines.push('');
      }

      const reading = device.reading;
      const seconds = Math.max(
        0,
        Math.floor((now.getTime() - Date.parse(reading.timestamp)) / 1000),
      );
      const age =
        seconds < 60
          ? ago('secondsAgo', seconds)
          : seconds < 3600
            ? ago('minutesAgo', Math.floor(seconds / 60))
            : ago('hoursAgo', Math.floor(seconds / 3600));
      lines.push('<b>BMS ' + escapeHtml(device.name) + '</b> · ' + age);

      const parts: string[] = [];
      const stateOfCharge = reading.stateOfChargePct;
      if (isNumber(stateOfCharge)) {
        parts.push('<b>' + Math.round(stateOfCharge) + ' %</b>');
      }
      const packVoltage = reading.packVoltageV;
      if (isNumber(packVoltage)) {
        parts.push(`${fixed(packVoltage, 2)} ${unit('V')}`);
      }
      const current = reading.currentA;
      if (isNumber(current)) {
        parts.push(`${fixed(current, 1)} ${unit('A')}`);
      }
      const power = reading.powerW;
      if (isNumber(power)) {
        parts.push(`${Math.round(power)} ${unit('W')}`);
      }
      if (parts.length > 0) {
        lines.push(parts.join(' · '));
      }

      const cellMin = reading.cellMinV;
      const cellMax = reading.cellMaxV;
      const cellDelta = reading.cellDeltaV;
      if (isNumber(cellMin) && isNumber(cellMax) && isNumber(cellDelta)) {
        let cells =
          `${card('cells')} ${fixed(cellMin, 3)}–${fixed(cellMax, 3)} ${unit('V')}` +
          ` · Δ ${Math.round(cellDelta * 1000)} ${unit('mV')}`;
        const minIndex = reading.cellMinIndex;
        const maxIndex = reading.cellMaxIndex;
        if (isNumber(minIndex) && isNumber(maxIndex)) {
          cells += ` (${card('low')} #${Math.round(minIndex)}, ${card('high')} #${Math.round(maxIndex)})`;
        }
        lines.push(cells);
      }

      const temps: string[] = [];
      const temperatures = reading.temperaturesC ?? [];
      for (const temperature of temperatures) {
        if (isNumber(temperature.celsius)) {
          temps.push(
            escapeHtml(String(temperature.name)) +
              ' ' +
              fixed(temperature.celsius, 1) +
              ' °C',
          );
        }
      }
      if (temps.length > 0) {
        lines.push(card('temp') + ' ' + temps.join(' · '));
      }

      const cycleCount = reading.cycleCount;
      const balancing = reading.balancing === true;
      if (isNumber(cycleCount) || balancing) {
        let cycleLine = isNumber(cycleCount)
          ? card('cycles') + ' ' + Math.round(cycleCount)
          : '';
        if (balancing) {
          cycleLine = cycleLine
            ? cycleLine + ' · ' + card('balancing')
            : card('balancing');
        }
        lines.push(cycleLine);
      }

      const alarms = reading.alarms ?? [];
      for (const alarm of alarms) {
        if (typeof alarm === 'string') {
          lines.push('⚠️ ' + escapeHtml(bmsAlarmName(alarm, language)));
        }
      }
    });
  }

  return lines.join('\n');
}

/** Format active faults and warnings as a Telegram HTML card. */
export function faultsCard(
  name: string,
  payload: Record<string, number> | null,
  language: Language,
): string {
  const { card, map, modeName } = wording(language);
  const header = '<b>🚨 ' + escapeHtml(name) + '</b>';
  if (!payload) {
    return header + '\n' + card('noReadings');
  }

  const mode = modeName(payload['OperationMode']);
  const fullHeader = mode ? header + ' · ' + escapeHtml(mode) : header;
  const faults = map.activeFlags(
    'FaultCode',
    numberOrZero(payload['FaultCode']),
  );
  const warnings = map.activeFlags(
    'WarningCode',
    numberOrZero(payload['WarningCode']),
  );

  if (faults.length === 0 && warnings.length === 0) {
    return fullHeader + '\n✅ ' + card('noFaults');
  }

  const faultText =
    faults.length > 0 ? faults.map(escapeHtml).join(', ') : card('none');
  const warningText =
    warnings.length > 0 ? warnings.map(escapeHtml).join(', ') : card('none');
  return [
    fullHeader,
    `${card('faults')}: ${faultText}`,
    `${card('warnings')}: ${warningText}`,
  ].join('\n');
}

/** Columns of the week table: day, then PV, grid and load. */
const WEEK_COLUMNS = [7, 7, 8, 8];

/** Format a fixed-width weekly kWh table as a Telegram HTML card. */
export function weekCard(
  name: string,
  days: { label: string; totals: EnergyTotals }[],
  language: Language,
): string {
  const { card, fixed } = wording(language);
  const total = days.reduce(
    (acc, day) => ({
      pv: acc.pv + numberOrZero(day.totals.pvKWh),
      grid: acc.grid + numberOrZero(day.totals.gridKWh),
      load: acc.load + numberOrZero(day.totals.outputKWh),
    }),
    { pv: 0, grid: 0, load: 0 },
  );
  const row = (cells: string[]) =>
    cells
      .map((cell, i) =>
        i === 0
          ? escapeHtml(cell).padEnd(WEEK_COLUMNS[i])
          : cell.padStart(WEEK_COLUMNS[i]),
      )
      .join('');
  const kWh = (v: unknown) => fixed(numberOrZero(v), 1);

  const lines: string[] = [
    `<b>📅 ${escapeHtml(name)} · ${card('kWhByDay')}</b>`,
    '<pre>',
    row([card('day'), card('pv'), card('colGrid'), card('colLoad')]),
  ];
  for (const day of days) {
    lines.push(
      row([
        day.label,
        kWh(day.totals.pvKWh),
        kWh(day.totals.gridKWh),
        kWh(day.totals.outputKWh),
      ]),
    );
  }
  lines.push(
    row([card('total'), kWh(total.pv), kWh(total.grid), kWh(total.load)]),
  );
  lines.push('</pre>');

  return lines.join('\n');
}
