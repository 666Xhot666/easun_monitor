import type { AlertMessage } from '../alerts/alert-message';
import { SMG_II_READINGS } from '../inverter/readings/smg-ii.readings';
import { activeBits } from '../inverter/registers/register-map';
import {
  CELL_LOW_ABOVE_RECOVERY_V,
  GRID_PRESENT_V,
  RECOVER_POINTS,
} from './constants';

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

/**
 * Computes inverter alert state and transition messages. A low battery is
 * judged by `bmsSoc` when given (the BMS's live charge): the inverter's own
 * SOC is worked out from its voltage reading and drops far under load.
 */
export function inverterAlerts(
  previous: InverterAlertState | undefined,
  reading: Record<string, number>,
  lowSoc: number,
  bmsSoc?: number | null,
): { state: InverterAlertState; messages: AlertMessage[] } {
  // Fault and warning codes are the device's own; the rest is common.
  const faultCode = reading.FaultCode;
  const warningCode = reading.WarningCode;
  const { gridVoltage, batterySoc } = SMG_II_READINGS.common(reading);
  const soc = isNumber(bmsSoc) ? bmsSoc : batterySoc;

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

/** Whether a low cell is being watched or was reported. */
export interface CellLowState {
  /** When the lowest cell went under the limit (ms), while it stays there. */
  belowSince?: number;
  /** Reported; re-armed once the cell recovers past limit + recoverV. */
  reported: boolean;
}

export interface CellLowReading {
  atMs: number;
  /** The grid as the inverter last saw it; undefined while unknown. */
  gridUp: boolean | undefined;
  cellMinV: number | null;
  cellMinIndex: number | null;
  packVoltageV: number | null;
  currentA: number | null;
  stateOfChargePct: number | null;
}

export interface CellLowLimits {
  thresholdV: number;
  holdMs: number;
  recoverV: number;
}

/**
 * A cell sagging under the limit while the grid is down, for longer than a
 * passing load step: reported once with the pack's state at that moment.
 */
export function cellLowAlerts(
  previous: CellLowState | undefined,
  reading: CellLowReading,
  limits: CellLowLimits,
): { state: CellLowState; messages: AlertMessage[] } {
  const reported = previous?.reported ?? false;
  const v = reading.cellMinV;
  if (!isNumber(v)) return { state: previous ?? { reported }, messages: [] };
  const stillReported = reported && v < limits.thresholdV + limits.recoverV;
  if (reading.gridUp !== false || v >= limits.thresholdV)
    return { state: { reported: stillReported }, messages: [] };

  const belowSince = previous?.belowSince ?? reading.atMs;
  if (stillReported || reading.atMs - belowSince < limits.holdMs)
    return { state: { belowSince, reported: stillReported }, messages: [] };

  return {
    state: { belowSince, reported: true },
    messages: [
      {
        key: 'bmsCellLow',
        params: {
          cell: reading.cellMinIndex,
          cellMv: Math.round(v * 1000),
          packV: reading.packVoltageV,
          currentA: isNumber(reading.currentA)
            ? Math.abs(reading.currentA)
            : null,
          soc: reading.stateOfChargePct,
        },
      },
    ],
  };
}

/**
 * The lowest-cell voltage a BMS device is alerted at: its own limit when
 * set, else a little above the BMS's undervoltage recovery voltage (from
 * the settings it reported), so the alert comes before the BMS protects.
 * Null while neither is known: the cells' chemistry is not guessed.
 */
export function cellLowThreshold(
  deviceLimitV: number | null,
  bmsSettings: Record<string, unknown> | null,
): number | null {
  if (isNumber(deviceLimitV)) return deviceLimitV;
  const recovery = bmsSettings?.cellUndervoltageRecoveryV;
  return isNumber(recovery) ? recovery + CELL_LOW_ABOVE_RECOVERY_V : null;
}
