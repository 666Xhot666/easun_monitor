/** A BMS device of an inverter, as served by GET /api/inverter/profiles/:id/bms. */
export interface BmsDevice {
  id: number;
  name: string;
  sourceType: 'mac-ble' | 'esp32';
  bluetoothId: string | null;
  /** When the last reading arrived (ISO 8601), or null if none yet. */
  lastSeenAt: string | null;
  createdAt: string;
  inverterProfileId: number;
  /** The energy flow shows this BMS's live battery values instead of the inverter's. */
  useForEnergyFlow: boolean;
  /** Lowest-cell voltage alerted at while off-grid; null: a little above the BMS's own undervoltage recovery. */
  cellLowAlertV: number | null;
}

export interface BmsTemperature {
  name: string;
  celsius: number;
}

/**
 * One normalized BMS reading (the server's BmsReading). Fields the BMS
 * variant does not provide are null. Current: positive while charging,
 * negative while discharging, as decoded; see the BMS first-run notes.
 */
export interface BmsReading {
  timestamp: string;
  source: 'mac-ble' | 'esp32';
  protocol: string;
  decoderVersion: string;
  packVoltageV: number | null;
  currentA: number | null;
  powerW: number | null;
  stateOfChargePct: number | null;
  /** The fields from here to cellWireResistancesOhm are missing on readings stored before the BMS reported them. */
  stateOfHealthPct?: number | null;
  remainingCapacityAh: number | null;
  nominalCapacityAh: number | null;
  cycleCount: number | null;
  /** Charge the pack has moved over its life. */
  totalCycleCapacityAh?: number | null;
  runTimeSeconds?: number | null;
  cellVoltagesV: number[];
  /** Balance-wire resistance per cell, cell 1 first. */
  cellWireResistancesOhm?: number[];
  cellMinV: number | null;
  cellMaxV: number | null;
  cellAverageV: number | null;
  cellDeltaV: number | null;
  cellMinIndex: number | null;
  cellMaxIndex: number | null;
  temperaturesC: BmsTemperature[];
  temperatureSensorMask: number | null;
  balancing: boolean | null;
  balanceCurrentA: number | null;
  chargeMosfetOn: boolean | null;
  dischargeMosfetOn: boolean | null;
  alarmMask: number | null;
  alarms: string[];
}

/** GET .../bms/:bmsId/latest: stale once the reading is older than 30 s. */
export interface BmsLatest {
  reading: BmsReading;
  ageSeconds: number;
  status: 'live' | 'stale';
}

/** GET .../bms/:bmsId/settings: the BMS's own settings as last reported, read-only. */
export interface BmsSettingsReport {
  protocol: string;
  decoderVersion: string;
  /** When the BMS sent them (ISO 8601). */
  receivedAt: string;
  /** Setting name → value in V, A, s, °C or Ah; switches as booleans. */
  settings: Record<string, number | boolean>;
}

/** How the inverter's battery voltage relates to the BMS's: inverter = battery + offsetV + resistanceOhm × current (+ charging). */
export interface WiringFit {
  resistanceOhm: number;
  offsetV: number;
  samples: number;
  minCurrentA: number;
  maxCurrentA: number;
}

/** GET .../bms/:bmsId/wiring: fitted over the last days, and per week. */
export interface BmsWiring {
  overall: WiringFit | null;
  weeks: { from: string; fit: WiringFit }[];
}
