import type { BmsProtocol } from './jk/variants';

/** Where a reading came from. The server treats all sources alike. */
export const BMS_SOURCES = ['mac-ble', 'esp32'] as const;
export type BmsSource = (typeof BMS_SOURCES)[number];

export interface BmsTemperature {
  /** "T1".."T5" for the external sensors, "MOS" for the MOSFET sensor. */
  name: string;
  celsius: number;
}

/**
 * One BMS reading, normalized: independent of Bluetooth and of the
 * protocol variant. Every producer (the Mac reader now, an ESP32 later)
 * sends exactly this to the ingest endpoint. Fields a variant does not
 * provide are null, never guessed.
 */
export interface BmsReading {
  /** When the frame was received (ISO 8601). */
  timestamp: string;
  source: BmsSource;
  protocol: BmsProtocol;
  /** Version of the decoder that produced this, to re-decode after fixes. */
  decoderVersion: string;

  packVoltageV: number | null;
  /**
   * Pack current in amperes. Sign: positive while charging, negative while
   * discharging, as the reference decodes it (its fixture "charging at
   * 31.881 A" reads +31.881). Confirmed by the owner on 2026-10-07 against
   * the BMS's own display, JK-PB2A16S20P (hardware 19U, software 19.28).
   */
  currentA: number | null;
  /** packVoltageV x currentA, same sign as the current. */
  powerW: number | null;
  stateOfChargePct: number | null;
  remainingCapacityAh: number | null;
  nominalCapacityAh: number | null;
  cycleCount: number | null;

  /** Voltages of the enabled cells, cell 1 first. */
  cellVoltagesV: number[];
  cellMinV: number | null;
  cellMaxV: number | null;
  cellAverageV: number | null;
  cellDeltaV: number | null;
  /** 1-based cell numbers of the lowest and highest cell. */
  cellMinIndex: number | null;
  cellMaxIndex: number | null;

  temperaturesC: BmsTemperature[];
  /** Raw "temperature sensor absent" bitmask, kept until Part E explains it. */
  temperatureSensorMask: number | null;

  balancing: boolean | null;
  balanceCurrentA: number | null;
  chargeMosfetOn: boolean | null;
  dischargeMosfetOn: boolean | null;

  /** Raw alarm/error bitmask, and the names the reference gives its bits. */
  alarmMask: number | null;
  alarms: string[];
}

/** The part of a reading a cell-info frame provides. */
export type BmsCellInfo = Omit<
  BmsReading,
  'timestamp' | 'source' | 'decoderVersion'
>;
