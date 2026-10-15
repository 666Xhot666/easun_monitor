import { bmsAlerts, inverterAlerts, type InverterAlertState } from './alerts';

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
