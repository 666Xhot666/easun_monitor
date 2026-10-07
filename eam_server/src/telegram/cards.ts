import type { RegisterMap } from '../inverter/registers/register-map';
import type { BmsReading } from '../bms/reading';
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

function watts(value: unknown): string {
  if (!isNumber(value)) {
    return '--';
  }
  if (Math.abs(value) >= 1000) {
    return (value / 1000).toFixed(2) + ' kW';
  }
  return Math.round(value) + ' W';
}

function kWhValue(value: unknown): string {
  const v = numberOrZero(value);
  return v.toFixed(v < 10 ? 2 : 1);
}

function kWh(value: unknown): string {
  return kWhValue(value) + ' kWh';
}

function fixed1(value: unknown): string {
  return numberOrZero(value).toFixed(1);
}

function modeName(map: RegisterMap, value: unknown): string | undefined {
  if (!isNumber(value)) {
    return undefined;
  }
  const option = map.get('OperationMode')?.options?.[value];
  return typeof option === 'string' && option.length > 0 ? option : undefined;
}

function statusAge(timestamp: Date, now: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - timestamp.getTime()) / 60000),
  );
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return minutes + ' min ago';
  }
  return Math.floor(minutes / 60) + ' h ago';
}

function bmsAge(timestamp: string, now: Date): string {
  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(timestamp)) / 1000),
  );
  if (seconds < 60) {
    return seconds + ' s ago';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes + ' min ago';
  }
  return Math.floor(minutes / 60) + ' h ago';
}

/** Format the inverter status as a Telegram HTML card. */
export function statusCard(
  name: string,
  map: RegisterMap,
  reading: { timestamp: Date; payload: Record<string, number> } | null,
  now: Date,
): string {
  const header = '<b>🏠 ' + escapeHtml(name) + '</b>';
  if (!reading) {
    return header + '\nNo readings yet';
  }

  const payload = reading.payload;
  const mode = modeName(map, payload['OperationMode']);
  const lines: string[] = [mode ? header + ' · ' + escapeHtml(mode) : header];

  lines.push('☀️ PV <b>' + watts(payload['PVPower']) + '</b>');
  lines.push('🏡 Load <b>' + watts(payload['OutputActivePower']) + '</b>');

  let grid = '🔌 Grid <b>' + watts(payload['AverageMainsPower']) + '</b>';
  const mainsVoltage = payload['MainsVoltage'];
  if (isNumber(mainsVoltage) && mainsVoltage <= 100) {
    grid += ' · no grid';
  }
  lines.push(grid);

  const soc = payload['BatterySoc'];
  if (isNumber(soc)) {
    let battery = '🔋 Battery <b>' + Math.round(soc) + ' %</b>';
    const voltage = payload['BatteryVoltage'];
    const current = payload['BatteryCurrentSigned'];
    if (isNumber(voltage) && isNumber(current)) {
      const power = voltage * current;
      if (Math.abs(power) <= 10) {
        battery += ' · idle';
      } else {
        battery +=
          ' · ' +
          (power < 0 ? 'discharging' : 'charging') +
          ' ' +
          watts(Math.abs(power));
      }
    }
    lines.push(battery);
  }

  lines.push('<i>Reading ' + statusAge(reading.timestamp, now) + '</i>');
  return lines.join('\n');
}

/** Format today's energy totals as a Telegram HTML card. */
export function energyCard(name: string, totals: EnergyTotals): string {
  const lines: string[] = [
    '<b>⚡ ' + escapeHtml(name) + ' · today</b>',
    '☀️ PV <b>' + kWh(totals.pvKWh) + '</b>',
    '🔌 Grid <b>' + kWh(totals.gridKWh) + '</b>',
    '🏡 Load <b>' + kWh(totals.outputKWh) + '</b>',
    '🔋 Battery <b>+' +
      kWhValue(totals.batteryChargeKWh) +
      '</b> charged · <b>-' +
      kWhValue(totals.batteryDischargeKWh) +
      ' kWh</b> used',
  ];
  return lines.join('\n');
}

/** Format the inverter and BMS battery views as a Telegram HTML card. */
export function batteryCard(
  name: string,
  payload: Record<string, number> | null,
  devices: { name: string; reading: BmsReading }[],
  now: Date,
): string {
  const lines: string[] = ['<b>🔋 ' + escapeHtml(name) + '</b>'];

  const soc = payload?.['BatterySoc'];
  if (!isNumber(soc)) {
    lines.push('Inverter: no reading');
  } else {
    let inverter = 'Inverter: <b>' + Math.round(soc) + ' %</b>';
    const voltage = payload?.['BatteryVoltage'];
    if (isNumber(voltage)) {
      inverter += ' · ' + voltage.toFixed(2) + ' V';
    }
    const current = payload?.['BatteryCurrentSigned'];
    if (isNumber(current)) {
      inverter += ' · ' + current.toFixed(1) + ' A';
    }
    lines.push(inverter);
  }

  lines.push('');

  if (devices.length === 0) {
    lines.push('No BMS reporting.');
  } else {
    devices.forEach((device, index) => {
      if (index > 0) {
        lines.push('');
      }

      const reading = device.reading;
      lines.push(
        '<b>BMS ' +
          escapeHtml(device.name) +
          '</b> · ' +
          bmsAge(reading.timestamp, now),
      );

      const parts: string[] = [];
      const stateOfCharge = reading.stateOfChargePct;
      if (isNumber(stateOfCharge)) {
        parts.push('<b>' + Math.round(stateOfCharge) + ' %</b>');
      }
      const packVoltage = reading.packVoltageV;
      if (isNumber(packVoltage)) {
        parts.push(packVoltage.toFixed(2) + ' V');
      }
      const current = reading.currentA;
      if (isNumber(current)) {
        parts.push(current.toFixed(1) + ' A');
      }
      const power = reading.powerW;
      if (isNumber(power)) {
        parts.push(Math.round(power) + ' W');
      }
      if (parts.length > 0) {
        lines.push(parts.join(' · '));
      }

      const cellMin = reading.cellMinV;
      const cellMax = reading.cellMaxV;
      const cellDelta = reading.cellDeltaV;
      if (isNumber(cellMin) && isNumber(cellMax) && isNumber(cellDelta)) {
        let cells =
          'Cells ' +
          cellMin.toFixed(3) +
          '–' +
          cellMax.toFixed(3) +
          ' V · Δ ' +
          Math.round(cellDelta * 1000) +
          ' mV';
        const minIndex = reading.cellMinIndex;
        const maxIndex = reading.cellMaxIndex;
        if (isNumber(minIndex) && isNumber(maxIndex)) {
          cells +=
            ' (low #' +
            Math.round(minIndex) +
            ', high #' +
            Math.round(maxIndex) +
            ')';
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
              temperature.celsius.toFixed(1) +
              ' °C',
          );
        }
      }
      if (temps.length > 0) {
        lines.push('Temp ' + temps.join(' · '));
      }

      const cycleCount = reading.cycleCount;
      const balancing = reading.balancing === true;
      if (isNumber(cycleCount) || balancing) {
        let cycleLine = isNumber(cycleCount)
          ? 'Cycles ' + Math.round(cycleCount)
          : '';
        if (balancing) {
          cycleLine = cycleLine ? cycleLine + ' · balancing' : 'balancing';
        }
        lines.push(cycleLine);
      }

      const alarms = reading.alarms ?? [];
      for (const alarm of alarms) {
        if (typeof alarm === 'string') {
          lines.push('⚠️ ' + escapeHtml(alarm));
        }
      }
    });
  }

  return lines.join('\n');
}

/** Format active faults and warnings as a Telegram HTML card. */
export function faultsCard(
  name: string,
  map: RegisterMap,
  payload: Record<string, number> | null,
): string {
  const header = '<b>🚨 ' + escapeHtml(name) + '</b>';
  if (!payload) {
    return header + '\nNo readings yet';
  }

  const mode = modeName(map, payload['OperationMode']);
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
    return fullHeader + '\n✅ No faults or warnings';
  }

  const faultText =
    faults.length > 0 ? faults.map(escapeHtml).join(', ') : 'none';
  const warningText =
    warnings.length > 0 ? warnings.map(escapeHtml).join(', ') : 'none';
  return [fullHeader, 'Faults: ' + faultText, 'Warnings: ' + warningText].join(
    '\n',
  );
}

/** Format a fixed-width weekly kWh table as a Telegram HTML card. */
export function weekCard(
  name: string,
  days: { label: string; totals: EnergyTotals }[],
): string {
  const header =
    'Day'.padEnd(6) +
    'PV'.padStart(7) +
    'Grid'.padStart(6) +
    'Load'.padStart(6);
  const total = days.reduce(
    (acc, day) => ({
      pv: acc.pv + numberOrZero(day.totals.pvKWh),
      grid: acc.grid + numberOrZero(day.totals.gridKWh),
      load: acc.load + numberOrZero(day.totals.outputKWh),
    }),
    { pv: 0, grid: 0, load: 0 },
  );

  const lines: string[] = [
    '<b>📅 ' + escapeHtml(name) + ' · kWh by day</b>',
    '<pre>',
    header,
  ];

  for (const day of days) {
    lines.push(
      weekRow(
        day.label,
        day.totals.pvKWh,
        day.totals.gridKWh,
        day.totals.outputKWh,
      ),
    );
  }
  lines.push(weekRow('Total', total.pv, total.grid, total.load));
  lines.push('</pre>');

  return lines.join('\n');
}

function weekRow(
  label: string,
  pv: unknown,
  grid: unknown,
  load: unknown,
): string {
  return (
    escapeHtml(label).padEnd(6) +
    fixed1(pv).padStart(7) +
    fixed1(grid).padStart(6) +
    fixed1(load).padStart(6)
  );
}
