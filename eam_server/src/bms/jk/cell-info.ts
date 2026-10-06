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

  let cellMinIndex: number | null = null;
  let cellMaxIndex: number | null = null;
  cellVoltagesV.forEach((v, i) => {
    if (v > 0 && (cellMinIndex === null || v < cellVoltagesV[cellMinIndex - 1]))
      cellMinIndex = i + 1;
    if (cellMaxIndex === null || v > cellVoltagesV[cellMaxIndex - 1])
      cellMaxIndex = i + 1;
  });
  const live = cellVoltagesV.filter((v) => v > 0);
  const cellMinV =
    cellMinIndex === null ? null : cellVoltagesV[cellMinIndex - 1];
  const cellMaxV =
    cellMaxIndex === null ? null : cellVoltagesV[cellMaxIndex - 1];

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
    remainingCapacityAh: frame.readUInt32LE(142 + o) / 1000,
    nominalCapacityAh: frame.readUInt32LE(146 + o) / 1000,
    cycleCount: frame.readUInt32LE(150 + o),
    cellVoltagesV,
    cellMinV,
    cellMaxV,
    cellAverageV: live.length
      ? round(live.reduce((a, b) => a + b, 0) / live.length, 4)
      : null,
    cellDeltaV:
      cellMinV === null || cellMaxV === null
        ? null
        : round(cellMaxV - cellMinV, 3),
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
