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
  remainingCapacityAh: number | null;
  nominalCapacityAh: number | null;
  cycleCount: number | null;
  cellVoltagesV: number[];
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
