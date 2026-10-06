import type { RegisterMap } from '../inverter/registers/register-map';

/** Mains above this voltage counts as the grid being there. */
const GRID_PRESENT_V = 100;
/** A low battery is reported again only after it recovers this many points. */
const RECOVER_POINTS = 5;

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

/** Inverter alert state derived from register readings. */
export interface InverterAlertState {
  faults: string[];
  warnings: string[];
  gridUp?: boolean;
  batteryLow?: boolean;
}

/** Computes inverter alert state and transition messages. */
export function inverterAlerts(
  previous: InverterAlertState | undefined,
  reading: Record<string, number>,
  map: RegisterMap,
  lowSoc: number,
): { state: InverterAlertState; messages: string[] } {
  const faultCode = reading.FaultCode;
  const warningCode = reading.WarningCode;
  const mainsVoltage = reading.MainsVoltage;
  const soc = reading.BatterySoc;

  const faults = isNumber(faultCode)
    ? map.activeFlags('FaultCode', faultCode)
    : (previous?.faults ?? []);
  const warnings = isNumber(warningCode)
    ? map.activeFlags('WarningCode', warningCode)
    : (previous?.warnings ?? []);
  const gridUp = isNumber(mainsVoltage)
    ? mainsVoltage > GRID_PRESENT_V
    : previous?.gridUp;
  const batteryLow = !isNumber(soc)
    ? previous?.batteryLow
    : previous?.batteryLow === true
      ? soc < lowSoc + RECOVER_POINTS
      : soc <= lowSoc;

  const state: InverterAlertState = { faults, warnings, gridUp, batteryLow };

  if (previous === undefined) {
    return { state, messages: [] };
  }

  const messages: string[] = [];
  const previousFaults = previous.faults;
  const previousWarnings = previous.warnings;

  for (const fault of faults) {
    if (!previousFaults.includes(fault)) {
      messages.push(`Fault: ${fault}`);
    }
  }

  if (previousFaults.length > 0 && faults.length === 0) {
    messages.push('Faults cleared');
  }

  for (const warning of warnings) {
    if (!previousWarnings.includes(warning)) {
      messages.push(`Warning: ${warning}`);
    }
  }

  if (previous.gridUp === true && gridUp === false) {
    messages.push('Grid lost');
  }

  if (previous.gridUp === false && gridUp === true) {
    messages.push('Grid restored');
  }

  if (batteryLow === true && previous.batteryLow !== true && isNumber(soc)) {
    messages.push(`Battery low: ${Math.round(soc)} %`);
  }

  return { state, messages };
}

/** Computes BMS alarm state and transition messages. */
export function bmsAlerts(
  previous: string[] | undefined,
  alarms: string[],
): { state: string[]; messages: string[] } {
  const state = alarms;

  if (previous === undefined) {
    return { state, messages: [] };
  }

  const messages: string[] = [];

  for (const alarm of alarms) {
    if (!previous.includes(alarm)) {
      messages.push(`BMS alarm: ${alarm}`);
    }
  }

  if (previous.length > 0 && alarms.length === 0) {
    messages.push('BMS alarms cleared');
  }

  return { state, messages };
}
