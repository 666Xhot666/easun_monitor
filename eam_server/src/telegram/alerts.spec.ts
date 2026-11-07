import {
  bmsAlerts,
  cellLowAlerts,
  inverterAlerts,
  type CellLowState,
  type InverterAlertState,
} from './alerts';

const LOW_SOC = 20;

/** Feeds readings in order; returns the messages of each step. */
function run(readings: Record<string, number>[]) {
  let state: InverterAlertState | undefined;
  return readings.map((reading) => {
    const result = inverterAlerts(state, reading, LOW_SOC);
    state = result.state;
    return result.messages;
  });
}

describe('inverterAlerts', () => {
  it('takes the first reading as the baseline, without messages', () => {
    expect(run([{ FaultCode: 1, MainsVoltage: 0, BatterySoc: 5 }])).toEqual([
      [],
    ]);
  });

  it('reports new faults and warnings by bit, and when faults clear', () => {
    expect(
      run([
        { FaultCode: 0, WarningCode: 0 },
        { FaultCode: 2, WarningCode: 8 },
        { FaultCode: 2, WarningCode: 8 },
        { FaultCode: 0, WarningCode: 0 },
      ]),
    ).toEqual([
      [],
      [
        { key: 'fault', params: { fault: 1 } },
        { key: 'warning', params: { warning: 3 } },
      ],
      [],
      [{ key: 'faultsCleared' }],
    ]);
  });

  it('reports the grid going and coming back', () => {
    expect(
      run([
        { MainsVoltage: 230 },
        { MainsVoltage: 0 },
        { MainsVoltage: 5 },
        { MainsVoltage: 228 },
      ]),
    ).toEqual([[], [{ key: 'gridLost' }], [], [{ key: 'gridRestored' }]]);
  });

  it('reports a low battery once, again only after it recovers 5 points', () => {
    expect(
      run([
        { BatterySoc: 30 },
        { BatterySoc: 20 },
        { BatterySoc: 19 },
        { BatterySoc: 24 },
        { BatterySoc: 18 },
        { BatterySoc: 25 },
        { BatterySoc: 20 },
      ]),
    ).toEqual([
      [],
      [{ key: 'batteryLow', params: { soc: 20 } }],
      [],
      [],
      [],
      [],
      [{ key: 'batteryLow', params: { soc: 20 } }],
    ]);
  });

  it("judges a low battery by the BMS's charge when there is one, not the inverter's voltage guess", () => {
    // Under a heavy load the inverter guesses 26 % while the BMS knows 48 %.
    const first = inverterAlerts(undefined, { BatterySoc: 80 }, LOW_SOC, 80);
    const loaded = inverterAlerts(first.state, { BatterySoc: 26 }, LOW_SOC, 48);
    expect(loaded.messages).toEqual([]);
    const sag = inverterAlerts(loaded.state, { BatterySoc: 15 }, LOW_SOC, 47);
    expect(sag.messages).toEqual([]);
    const low = inverterAlerts(sag.state, { BatterySoc: 60 }, LOW_SOC, 19.6);
    expect(low.messages).toEqual([{ key: 'batteryLow', params: { soc: 20 } }]);
  });

  it('ignores values a reading does not carry', () => {
    expect(
      run([
        { MainsVoltage: 230, BatterySoc: 50, FaultCode: 0 },
        { PVPower: 100 },
        { MainsVoltage: 0 },
      ]),
    ).toEqual([[], [], [{ key: 'gridLost' }]]);
  });
});

describe('bmsAlerts', () => {
  it('reports new alarms, and when all clear, after a silent baseline', () => {
    expect(bmsAlerts(undefined, ['Cell overvoltage'])).toEqual({
      state: ['Cell overvoltage'],
      messages: [],
    });
    expect(
      bmsAlerts([], ['Cell overvoltage', 'Charge overtemperature']),
    ).toEqual({
      state: ['Cell overvoltage', 'Charge overtemperature'],
      messages: [
        { key: 'bmsAlarm', params: { alarm: 'Cell overvoltage' } },
        { key: 'bmsAlarm', params: { alarm: 'Charge overtemperature' } },
      ],
    });
    expect(
      bmsAlerts(['Cell overvoltage'], ['Cell overvoltage']).messages,
    ).toEqual([]);
    expect(bmsAlerts(['Cell overvoltage'], [])).toEqual({
      state: [],
      messages: [{ key: 'bmsAlarmsCleared' }],
    });
  });
});

describe('cellLowAlerts', () => {
  const LIMITS = { thresholdV: 3.0, holdMs: 10_000, recoverV: 0.05 };
  const reading = (atS: number, cellMinV: number, gridUp = false) => ({
    atMs: atS * 1000,
    gridUp,
    cellMinV,
    cellMinIndex: 4,
    packVoltageV: 24.1,
    currentA: -75.4,
    stateOfChargePct: 31,
  });
  /** Feeds readings in order; returns the messages of each step. */
  const run = (readings: ReturnType<typeof reading>[]) => {
    let state: CellLowState | undefined;
    return readings.map((r) => {
      const result = cellLowAlerts(state, r, LIMITS);
      state = result.state;
      return result.messages;
    });
  };
  const alert = {
    key: 'bmsCellLow',
    params: { cell: 4, cellMv: 2980, packV: 24.1, currentA: 75.4, soc: 31 },
  };

  it('reports a cell staying under the limit while off-grid, once', () => {
    expect(
      run([
        reading(0, 3.1),
        reading(1, 2.98),
        reading(6, 2.98),
        reading(11, 2.98),
        reading(20, 2.97),
      ]),
    ).toEqual([[], [], [], [alert], []]);
  });

  it('ignores a dip shorter than the hold time', () => {
    expect(
      run([
        reading(0, 2.98),
        reading(5, 3.02),
        reading(9, 2.98),
        reading(15, 2.98),
      ]),
    ).toEqual([[], [], [], []]);
  });

  it('reports again only after the cell recovered past the limit plus the margin', () => {
    const steps = run([
      reading(0, 2.98),
      reading(10, 2.98),
      reading(20, 3.03),
      reading(30, 2.98),
      reading(40, 2.98),
      reading(50, 3.06),
      reading(60, 2.98),
      reading(70, 2.98),
    ]);
    expect(steps.map((m) => m.length)).toEqual([0, 1, 0, 0, 0, 0, 0, 1]);
  });

  it('stays quiet while the grid is up: then the inverter does not run on the battery', () => {
    expect(run([reading(0, 2.9, true), reading(20, 2.9, true)])).toEqual([
      [],
      [],
    ]);
  });
});
