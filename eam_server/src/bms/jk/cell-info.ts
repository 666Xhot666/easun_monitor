/**
 * JK BMS cell-info frame (type 0x02) for the JK02_24S and JK02_32S variants,
 * ported from syssi/esphome-jk-bms (components/jk_bms_ble/jk_bms_ble.cpp,
 * JkBmsBle::decode_jk02_cell_info_; alarm names from
 * components/jk_bms_ble/__init__.py, DEFAULT_ERRORS_JK02) at commit
 * 59c994e726c34b123e43eb0090736fd94706f0db.
 *
 * JK02_32S has 32 cell slots instead of 24, which moves the per-cell block
 * by 16 bytes and everything from byte 112 on by 32.
 */
import type { BmsCellInfo, BmsTemperature } from '../reading';
import type { BmsProtocol } from './variants';

export const CELL_INFO_FRAME = 0x02;

/** Names of the JK02 error bits; "" for bits the reference leaves unnamed. */
const ALARM_NAMES = [
  'Wire resistance',
  'MOSFET overtemperature',
  'Cell count is not equal to settings',
  '',
  'Battery is fully charged',
  'Battery pack overvoltage',
  'Charge overcurrent',
  'Charge short circuit',
  'Charge overtemperature',
  'Charge undertemperature',
  'Coprocessor communication error',
  'Cell undervoltage',
  'Battery pack undervoltage',
  'Discharge overcurrent',
  'Discharge short circuit',
  'Discharge overtemperature',
  'Charging MOSFET abnormal',
  'Discharging MOSFET abnormal',
  'GPS disconnected',
  'Modify password in time',
  'Discharge on failed',
  'Battery overtemperature',
  'Temperature sensor anomaly',
  'PL module anomaly',
  'SCP release failed',
  'Discharge OCP II',
  'Discharge OCP III',
  'Discharge undertemperature alarm',
  'GPS remote lock',
];

const round = (value: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

interface CellStats {
  cellAverageV: number | null;
  cellDeltaV: number | null;
  cellMinIndex: number | null;
  cellMaxIndex: number | null;
}

/** The BMS's own figures: average, delta (58, 60) and 0-based max/min cell (62, 63). */
function reportedCellStats(
  frame: Buffer,
  cellOffset: number,
  cells: number[],
): CellStats {
  if (cells.length === 0) {
    return {
      cellAverageV: null,
      cellDeltaV: null,
      cellMinIndex: null,
      cellMaxIndex: null,
    };
  }
  const index = (byte: number) => (byte < cells.length ? byte + 1 : null);
  return {
    cellAverageV: frame.readUInt16LE(58 + cellOffset) / 1000,
    cellDeltaV: frame.readUInt16LE(60 + cellOffset) / 1000,
    cellMaxIndex: index(frame[62 + cellOffset]),
    cellMinIndex: index(frame[63 + cellOffset]),
  };
}

/** Figures computed from the cell voltages, for variants not yet confirmed. */
function computedCellStats(cells: number[]): CellStats {
  let cellMinIndex: number | null = null;
  let cellMaxIndex: number | null = null;
  cells.forEach((v, i) => {
    if (v > 0 && (cellMinIndex === null || v < cells[cellMinIndex - 1]))
      cellMinIndex = i + 1;
    if (cellMaxIndex === null || v > cells[cellMaxIndex - 1])
      cellMaxIndex = i + 1;
  });
  const live = cells.filter((v) => v > 0);
  const min = cellMinIndex === null ? null : cells[cellMinIndex - 1];
  const max = cellMaxIndex === null ? null : cells[cellMaxIndex - 1];
  return {
    cellAverageV: live.length
      ? round(live.reduce((a, b) => a + b, 0) / live.length, 4)
      : null,
    cellDeltaV: min === null || max === null ? null : round(max - min, 3),
    cellMinIndex,
    cellMaxIndex,
  };
}

export function decodeCellInfo(
  frame: Buffer,
  protocol: BmsProtocol,
): BmsCellInfo {
  if (frame[4] !== CELL_INFO_FRAME) {
    throw new Error(`Not a cell info frame (type 0x${frame[4].toString(16)})`);
  }
  if (protocol === 'JK04') {
    throw new Error('The JK04 cell-info layout is not implemented yet');
  }
  const is32 = protocol === 'JK02_32S';
  const cellOffset = is32 ? 16 : 0;
  const o = cellOffset * 2;
  const slots = is32 ? 32 : 24;

  // Enabled cells bitmask (54 + cellOffset), little-endian.
  const enabled = frame.readUInt32LE(54 + cellOffset);
  const cellVoltagesV: number[] = [];
  for (let i = 0; i < slots && enabled & (2 ** i); i++) {
    cellVoltagesV.push(frame.readUInt16LE(6 + i * 2) / 1000);
  }

  // Wire resistance per cell (64 + cellOffset), in mΩ.
  const cellWireResistancesOhm = cellVoltagesV.map(
    (_, i) => frame.readUInt16LE(64 + cellOffset + i * 2) / 1000,
  );

  const stats = is32
    ? reportedCellStats(frame, cellOffset, cellVoltagesV)
    : computedCellStats(cellVoltagesV);
  const { cellMinIndex, cellMaxIndex } = stats;
  const cellMinV =
    cellMinIndex === null ? null : (cellVoltagesV[cellMinIndex - 1] ?? null);
  const cellMaxV =
    cellMaxIndex === null ? null : (cellVoltagesV[cellMaxIndex - 1] ?? null);

  const packVoltageV = frame.readUInt32LE(118 + o) / 1000;
  const currentA = frame.readInt32LE(126 + o) / 1000;

  const temperaturesC: BmsTemperature[] = [
    { name: 'T1', celsius: frame.readInt16LE(130 + o) / 10 },
    { name: 'T2', celsius: frame.readInt16LE(132 + o) / 10 },
    { name: 'MOS', celsius: frame.readInt16LE((is32 ? 112 : 134) + o) / 10 },
  ];
  if (is32) {
    temperaturesC.push(
      { name: 'T3', celsius: frame.readInt16LE(226 + o) / 10 },
      { name: 'T4', celsius: frame.readInt16LE(224 + o) / 10 },
      { name: 'T5', celsius: frame.readInt16LE(222 + o) / 10 },
    );
  }

  // 32S: 32-bit mask at 134; 24S: 16-bit mask at 136.
  const alarmMask = is32
    ? frame.readUInt32LE(134 + o)
    : frame.readUInt16LE(136 + o);
  const alarms = ALARM_NAMES.filter(
    (name, bit) => name !== '' && (alarmMask >>> 0) & (2 ** bit),
  );

  return {
    protocol,
    packVoltageV,
    currentA,
    powerW: round(packVoltageV * currentA, 3),
    stateOfChargePct: frame[141 + o],
    stateOfHealthPct: frame[158 + o],
    remainingCapacityAh: frame.readUInt32LE(142 + o) / 1000,
    nominalCapacityAh: frame.readUInt32LE(146 + o) / 1000,
    cycleCount: frame.readUInt32LE(150 + o),
    totalCycleCapacityAh: frame.readUInt32LE(154 + o) / 1000,
    runTimeSeconds: frame.readUInt32LE(162 + o),
    cellVoltagesV,
    cellWireResistancesOhm,
    cellMinV,
    cellMaxV,
    cellAverageV: stats.cellAverageV,
    cellDeltaV: stats.cellDeltaV,
    cellMinIndex,
    cellMaxIndex,
    temperaturesC,
    temperatureSensorMask: frame.readUInt16LE(182 + o),
    balancing: frame[140 + o] !== 0,
    balanceCurrentA: frame.readInt16LE(138 + o) / 1000,
    chargeMosfetOn: frame[166 + o] !== 0,
    dischargeMosfetOn: frame[167 + o] !== 0,
    alarmMask,
    alarms,
  };
}
