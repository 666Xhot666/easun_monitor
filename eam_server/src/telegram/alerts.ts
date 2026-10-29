import type { AlertMessage } from '../alerts/alert-message';
import { SMG_II_READINGS } from '../inverter/readings/smg-ii.readings';
import { activeBits } from '../inverter/registers/register-map';
import { GRID_PRESENT_V, RECOVER_POINTS } from './constants';

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

/** Inverter alert state derived from register readings. */
export interface InverterAlertState {
  /** Fault and warning bits set. */
  faults: number[];
  warnings: number[];
  gridUp?: boolean;
  batteryLow?: boolean;
}

/** Computes inverter alert state and transition messages. */
export function inverterAlerts(
  previous: InverterAlertState | undefined,
  reading: Record<string, number>,
  lowSoc: number,
): { state: InverterAlertState; messages: AlertMessage[] } {
  // Fault and warning codes are the device's own; the rest is common.
  const faultCode = reading.FaultCode;
  const warningCode = reading.WarningCode;
  const { gridVoltage, batterySoc: soc } = SMG_II_READINGS.common(reading);

  const faults = isNumber(faultCode)
    ? activeBits(faultCode)
    : (previous?.faults ?? []);
  const warnings = isNumber(warningCode)
    ? activeBits(warningCode)
    : (previous?.warnings ?? []);
  const gridUp = isNumber(gridVoltage)
    ? gridVoltage > GRID_PRESENT_V
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

  const messages: AlertMessage[] = [];
  const previousFaults = previous.faults;
  const previousWarnings = previous.warnings;

  for (const fault of faults) {
    if (!previousFaults.includes(fault)) {
      messages.push({ key: 'fault', params: { fault } });
    }
  }

  if (previousFaults.length > 0 && faults.length === 0) {
    messages.push({ key: 'faultsCleared' });
  }

  for (const warning of warnings) {
    if (!previousWarnings.includes(warning)) {
      messages.push({ key: 'warning', params: { warning } });
    }
  }

  if (previous.gridUp === true && gridUp === false) {
    messages.push({ key: 'gridLost' });
  }

  if (previous.gridUp === false && gridUp === true) {
    messages.push({ key: 'gridRestored' });
  }

  if (batteryLow === true && previous.batteryLow !== true && isNumber(soc)) {
    messages.push({ key: 'batteryLow', params: { soc: Math.round(soc) } });
  }

  return { state, messages };
}

/** Computes BMS alarm state and transition messages. */
export function bmsAlerts(
  previous: string[] | undefined,
  alarms: string[],
): { state: string[]; messages: AlertMessage[] } {
  const state = alarms;

  if (previous === undefined) {
    return { state, messages: [] };
  }

  const messages: AlertMessage[] = [];

  for (const alarm of alarms) {
    if (!previous.includes(alarm)) {
      messages.push({ key: 'bmsAlarm', params: { alarm } });
    }
  }

  if (previous.length > 0 && alarms.length === 0) {
    messages.push({ key: 'bmsAlarmsCleared' });
  }

  return { state, messages };
}
