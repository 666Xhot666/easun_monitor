import { decodeCellInfo } from './cell-info';
import { referenceFrame } from './testing/reference-frames';

// Vectors: cell-info frames from syssi/esphome-jk-bms's own tests (see
// testing/); expected values from the frames' comments and the reference's
// jk_bms_ble_*_test.cpp.
describe('decodeCellInfo, JK02_32S', () => {
  it('decodes cells, pack and status (v11, idle)', () => {
    const r = decodeCellInfo(
      referenceFrame('CELL_INFO_JK02_32S_V11'),
      'JK02_32S',
    );

    expect(r.cellVoltagesV).toHaveLength(16);
    expect(r.cellVoltagesV[0]).toBeCloseTo(3.246, 3);
    expect(r.cellVoltagesV[1]).toBeCloseTo(3.23, 3);
    expect(r.cellVoltagesV[15]).toBeCloseTo(3.242, 3);
    expect(r).toMatchObject({ cellMinIndex: 11, cellMaxIndex: 1 });
    expect(r.cellMinV).toBeCloseTo(3.216, 3);
    expect(r.cellMaxV).toBeCloseTo(3.246, 3);
    expect(r.cellDeltaV).toBeCloseTo(0.031, 3); // the BMS's figure; the cells give 0.030
    expect(r.packVoltageV).toBeCloseTo(51.689, 3);
    expect(r.currentA).toBe(0);
    expect(r.powerW).toBe(0);
    expect(r.stateOfChargePct).toBe(52);
    expect(r.remainingCapacityAh).toBeCloseTo(1.043, 3);
    expect(r.nominalCapacityAh).toBeCloseTo(2, 3);
    expect(r.cycleCount).toBe(0);
    expect(r).toMatchObject({ chargeMosfetOn: true, dischargeMosfetOn: true });
    const t = Object.fromEntries(
      r.temperaturesC.map((s) => [s.name, s.celsius]),
    );
    expect(t.T1).toBeCloseTo(17.7, 1);
    expect(t.T2).toBeCloseTo(17.7, 1);
    expect(t.MOS).toBeCloseTo(17.3, 1);
    expect(r.alarms).toEqual([]);
  });

  it('decodes a charging current as positive (v15)', () => {
    const r = decodeCellInfo(
      referenceFrame('CELL_INFO_JK02_32S_V15'),
      'JK02_32S',
    );
    expect(r.currentA).toBeCloseTo(31.881, 3);
    expect(r.packVoltageV).toBeCloseTo(53.224, 3);
    expect(r.powerW).toBeCloseTo(53.224 * 31.881, 1);
    expect(r).toMatchObject({
      stateOfChargePct: 25,
      cycleCount: 9,
      cellMinIndex: 13,
      cellMaxIndex: 16,
    });
    expect(r.cellDeltaV).toBeCloseTo(0.016, 3); // the BMS's figure; the cells give 0.017
  });

  it('decodes a discharging current as negative (v19)', () => {
    const r = decodeCellInfo(
      referenceFrame('CELL_INFO_JK02_32S_V19'),
      'JK02_32S',
    );
    expect(r.currentA).toBeCloseTo(-0.727, 3);
    expect(r.packVoltageV).toBeCloseTo(54.028, 3);
    expect(r).toMatchObject({
      stateOfChargePct: 100,
      cycleCount: 5,
      cellMinIndex: 10,
      cellMaxIndex: 1,
    });
    expect(r.remainingCapacityAh).toBeCloseTo(312.898, 3);
    expect(r.nominalCapacityAh).toBeCloseTo(314, 3);
    const t = Object.fromEntries(
      r.temperaturesC.map((s) => [s.name, s.celsius]),
    );
    expect(t.T1).toBeCloseTo(11.9, 1);
    expect(t.T2).toBeCloseTo(12.7, 1);
    expect(t.MOS).toBeCloseTo(12.8, 1);
  });

  it('names the alarm bits the reference names, and keeps the raw mask', () => {
    const frame = Buffer.from(referenceFrame('CELL_INFO_JK02_32S_V11'));
    frame.writeUInt32LE((1 << 11) | (1 << 5) | (1 << 3), 134 + 32); // bit 3 has no name
    const r = decodeCellInfo(frame, 'JK02_32S');
    expect(r.alarmMask).toBe((1 << 11) | (1 << 5) | (1 << 3));
    expect(r.alarms).toEqual(['Battery pack overvoltage', 'Cell undervoltage']);
  });
});

describe('decodeCellInfo, JK02_32S, what the BMS reports beyond the cells', () => {
  it("takes average, delta and the min/max cell from the BMS's own fields", () => {
    const r = decodeCellInfo(
      referenceFrame('CELL_INFO_REAL_PB2A16S20P_19U'),
      'JK02_32S',
    );
    expect(r.cellVoltagesV).toEqual([
      3.445, 3.447, 3.451, 3.443, 3.449, 3.443, 3.446, 3.449,
    ]);
    expect(r.cellAverageV).toBe(3.447);
    expect(r.cellDeltaV).toBe(0.008);
    expect(r).toMatchObject({ cellMaxIndex: 3, cellMinIndex: 4 });
    expect(r.cellMaxV).toBe(3.451);
    expect(r.cellMinV).toBe(3.443);
  });

  it("keeps the BMS's figures when they differ from the cell voltages", () => {
    // The BMS samples its statistics apart from the voltages it sends; about
    // one frame in ten disagrees, and the BMS's own display shows its figures.
    const r = decodeCellInfo(
      referenceFrame('CELL_INFO_JK02_32S_V19'),
      'JK02_32S',
    );
    expect(r.cellDeltaV).toBe(0.006);
    expect(r.cellAverageV).toBe(3.377);
    expect(r).toMatchObject({ cellMaxIndex: 1, cellMinIndex: 10 });
  });

  it('decodes wire resistance per cell, SOH, cycle capacity and run time', () => {
    const r = decodeCellInfo(
      referenceFrame('CELL_INFO_REAL_PB2A16S20P_19U'),
      'JK02_32S',
    );
    expect(r.cellWireResistancesOhm).toEqual([
      0.07, 0.068, 0.07, 0.067, 0.07, 0.068, 0.07, 0.068,
    ]);
    expect(r.stateOfHealthPct).toBe(100);
    expect(r.totalCycleCapacityAh).toBe(1489.001);
    expect(r.runTimeSeconds).toBe(8_791_797);
  });

  it('matches the run time and SOH the reference lists (v19)', () => {
    const r = decodeCellInfo(
      referenceFrame('CELL_INFO_JK02_32S_V19'),
      'JK02_32S',
    );
    expect(r).toMatchObject({
      runTimeSeconds: 3_609_276,
      stateOfHealthPct: 100,
    });
    expect(r.cellWireResistancesOhm).toHaveLength(16);
  });
});

describe('decodeCellInfo, JK02_24S, what the BMS reports beyond the cells', () => {
  it('matches the run time and SOH the reference lists (v10)', () => {
    const r = decodeCellInfo(
      referenceFrame('CELL_INFO_JK02_24S_V10'),
      'JK02_24S',
    );
    expect(r).toMatchObject({ runTimeSeconds: 269_340, stateOfHealthPct: 100 });
    expect(r.totalCycleCapacityAh).toBe(13.561);
    expect(r.cellWireResistancesOhm).toHaveLength(24);
    expect(r.cellWireResistancesOhm[0]).toBe(0.1);
  });
});

describe('decodeCellInfo, JK02_24S', () => {
  it('decodes cells, pack and status (v10)', () => {
    const r = decodeCellInfo(
      referenceFrame('CELL_INFO_JK02_24S_V10'),
      'JK02_24S',
    );
    expect(r.cellVoltagesV).toHaveLength(24);
    expect(r.cellVoltagesV[0]).toBeCloseTo(3.284, 3);
    expect(r.cellVoltagesV[2]).toBeCloseTo(3.279, 3);
    expect(r.cellVoltagesV[22]).toBeCloseTo(3.285, 3);
    expect(r).toMatchObject({
      cellMinIndex: 3,
      cellMaxIndex: 23,
      stateOfChargePct: 85,
    });
    expect(r.packVoltageV).toBeCloseTo(78.735, 3);
    expect(r.remainingCapacityAh).toBeCloseTo(42.804, 3);
    expect(r.nominalCapacityAh).toBeCloseTo(50, 3);
    expect(r).toMatchObject({ chargeMosfetOn: true, dischargeMosfetOn: false });
    const t = Object.fromEntries(
      r.temperaturesC.map((s) => [s.name, s.celsius]),
    );
    expect(t).toEqual({
      T1: expect.closeTo(20.7, 1),
      T2: expect.closeTo(20.7, 1),
      MOS: expect.closeTo(23.4, 1),
    });
  });

  it('decodes negative temperatures and a 13-cell pack', () => {
    const r = decodeCellInfo(
      referenceFrame('CELL_INFO_JK02_24S_V10_NEG_TEMPS'),
      'JK02_24S',
    );
    expect(r.cellVoltagesV).toHaveLength(13);
    expect(r).toMatchObject({
      cellMinIndex: 5,
      cellMaxIndex: 1,
      stateOfChargePct: 47,
      cycleCount: 56,
    });
    expect(r.packVoltageV).toBeCloseTo(42.786, 3);
    const t = Object.fromEntries(
      r.temperaturesC.map((s) => [s.name, s.celsius]),
    );
    expect(t.T1).toBeCloseTo(-3.1, 1);
    expect(t.T2).toBeCloseTo(-2.9, 1);
  });
});

describe('decodeCellInfo, checks', () => {
  it('rejects frames that are not cell info, and JK04 until a real unit needs it', () => {
    expect(() =>
      decodeCellInfo(referenceFrame('DEVICE_INFO_JK02_32S_V11'), 'JK02_32S'),
    ).toThrow(/cell info/);
    expect(() =>
      decodeCellInfo(referenceFrame('CELL_INFO_JK02_32S_V11'), 'JK04'),
    ).toThrow(/JK04/);
  });
});
