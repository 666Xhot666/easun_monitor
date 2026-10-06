import { RegisterMap } from '../inverter/registers/register-map';
import { SMG_II_REGISTERS } from '../inverter/registers/smg-ii.registers';
import { bmsAlerts, inverterAlerts, type InverterAlertState } from './alerts';

const map = new RegisterMap(SMG_II_REGISTERS);
const LOW_SOC = 20;

/** Feeds readings in order; returns the messages of each step. */
function run(readings: Record<string, number>[]) {
  let state: InverterAlertState | undefined;
  return readings.map((reading) => {
    const result = inverterAlerts(state, reading, map, LOW_SOC);
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

  it('reports new faults and warnings by name, and when faults clear', () => {
    const fault = map.activeFlags('FaultCode', 2)[0];
    const warning = map.activeFlags('WarningCode', 8)[0];

    expect(
      run([
        { FaultCode: 0, WarningCode: 0 },
        { FaultCode: 2, WarningCode: 8 },
        { FaultCode: 2, WarningCode: 8 },
        { FaultCode: 0, WarningCode: 0 },
      ]),
    ).toEqual([
      [],
      [`Fault: ${fault}`, `Warning: ${warning}`],
      [],
      ['Faults cleared'],
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
    ).toEqual([[], ['Grid lost'], [], ['Grid restored']]);
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
      ['Battery low: 20 %'],
      [],
      [],
      [],
      [],
      ['Battery low: 20 %'],
    ]);
  });

  it('ignores values a reading does not carry', () => {
    expect(
      run([
        { MainsVoltage: 230, BatterySoc: 50, FaultCode: 0 },
        { PVPower: 100 },
        { MainsVoltage: 0 },
      ]),
    ).toEqual([[], [], ['Grid lost']]);
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
        'BMS alarm: Cell overvoltage',
        'BMS alarm: Charge overtemperature',
      ],
    });
    expect(
      bmsAlerts(['Cell overvoltage'], ['Cell overvoltage']).messages,
    ).toEqual([]);
    expect(bmsAlerts(['Cell overvoltage'], [])).toEqual({
      state: [],
      messages: ['BMS alarms cleared'],
    });
  });
});
