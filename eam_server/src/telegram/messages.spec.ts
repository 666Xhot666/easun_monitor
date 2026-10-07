import { RegisterMap } from '../inverter/registers/register-map';
import { SMG_II_REGISTERS } from '../inverter/registers/smg-ii.registers';
import {
  clockTime,
  dayStart,
  duration,
  formatEnergy,
  formatStatus,
} from './messages';

const map = new RegisterMap(SMG_II_REGISTERS);
const NOW = new Date('2026-10-06T19:00:00Z');

describe('formatStatus', () => {
  it('summarizes the flow, battery and mode of the latest reading', () => {
    const text = formatStatus(
      'Home',
      map,
      {
        timestamp: new Date('2026-10-06T18:58:00Z'),
        payload: {
          OperationMode: 3,
          PVPower: 1240,
          OutputActivePower: 320,
          AverageMainsPower: 0,
          BatterySoc: 88,
          BatteryVoltage: 26.5,
          BatteryCurrentSigned: -11.7,
        },
      },
      NOW,
    );

    expect(text).toBe(
      [
        'Home: Off-grid, 2 min ago',
        'PV 1.24 kW · Load 320 W · Grid 0 W',
        'Battery 88 %, discharging 310 W',
      ].join('\n'),
    );
  });

  it('says charging, idle, and when values are missing', () => {
    const charging = formatStatus(
      'Home',
      map,
      {
        timestamp: NOW,
        payload: {
          BatterySoc: 60,
          BatteryVoltage: 27,
          BatteryCurrentSigned: 10,
        },
      },
      NOW,
    );
    expect(charging).toContain('Battery 60 %, charging 270 W');
    expect(charging).toContain('PV -- · Load -- · Grid --');
    expect(charging.split('\n')[0]).toBe('Home: just now');

    const idle = formatStatus(
      'Home',
      map,
      {
        timestamp: NOW,
        payload: {
          BatterySoc: 100,
          BatteryVoltage: 27,
          BatteryCurrentSigned: 0.1,
        },
      },
      NOW,
    );
    expect(idle).toContain('Battery 100 %, idle');
  });

  it('says when there is no reading yet', () => {
    expect(formatStatus('Home', map, null, NOW)).toBe('Home: no readings yet');
  });
});

describe('formatEnergy', () => {
  it("lists the day's energy per kind", () => {
    expect(
      formatEnergy('Home', {
        pvKWh: 3.456,
        gridKWh: 0.8,
        outputKWh: 12.34,
        batteryChargeKWh: 1.44,
        batteryDischargeKWh: 0.99,
        coveredSeconds: 36000,
      }),
    ).toBe(
      'Home today: PV 3.46 kWh · Grid 0.80 kWh · Load 12.3 kWh · Battery +1.44 / -0.99 kWh',
    );
  });
});

describe('clockTime', () => {
  it('is HH:MM in the given time zone', () => {
    expect(clockTime(NOW, 'Europe/Kyiv')).toBe('22:00');
    expect(clockTime(new Date('2026-10-06T00:05:00Z'), 'UTC')).toBe('00:05');
  });
});

describe('duration', () => {
  it('is whole minutes, with hours from an hour on', () => {
    expect(duration(30_000)).toBe('1 min');
    expect(duration(7 * 60_000)).toBe('7 min');
    expect(duration(60 * 60_000)).toBe('1 h');
    expect(duration(70 * 60_000)).toBe('1 h 10 min');
  });
});

describe('dayStart', () => {
  it('is local midnight in the given time zone', () => {
    expect(dayStart(NOW, 'Europe/Kyiv').toISOString()).toBe(
      '2026-10-05T21:00:00.000Z',
    );
    expect(
      dayStart(new Date('2026-10-06T22:30:00Z'), 'Europe/Kyiv').toISOString(),
    ).toBe('2026-10-06T21:00:00.000Z');
    expect(dayStart(NOW, 'UTC').toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });
});
