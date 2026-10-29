import { clockTime, dayStart, formatEnergy, formatTomorrow } from './messages';

const NOW = new Date('2026-10-06T19:00:00Z');

describe('formatEnergy', () => {
  it("lists the day's energy per kind", () => {
    expect(
      formatEnergy(
        'Home',
        {
          pvKWh: 3.456,
          gridKWh: 0.8,
          outputKWh: 12.34,
          batteryChargeKWh: 1.44,
          batteryDischargeKWh: 0.99,
          coveredSeconds: 36000,
        },
        'en',
      ),
    ).toBe(
      'Home today: PV 3.46 kWh · Grid 0.80 kWh · Load 12.3 kWh · Battery +1.44 / -0.99 kWh',
    );
  });
});

describe('formatTomorrow', () => {
  it("says how much sun tomorrow's weather allows", () => {
    expect(formatTomorrow({ expectedKWh: 6.24, cloudCover: 12 }, 'en')).toBe(
      '☀️ Tomorrow: about 6.2 kWh of sun expected · 12% cloud',
    );
    expect(formatTomorrow({ expectedKWh: 6.24, cloudCover: null }, 'uk')).toBe(
      '☀️ Завтра: очікується близько 6,2 кВт·год сонця',
    );
  });
});

describe('clockTime', () => {
  it('is HH:MM in the given time zone', () => {
    expect(clockTime(NOW, 'Europe/Helsinki')).toBe('22:00');
    expect(clockTime(new Date('2026-10-06T00:05:00Z'), 'UTC')).toBe('00:05');
  });
});

describe('dayStart', () => {
  it('is local midnight in the given time zone', () => {
    expect(dayStart(NOW, 'Europe/Helsinki').toISOString()).toBe(
      '2026-10-05T21:00:00.000Z',
    );
    expect(
      dayStart(
        new Date('2026-10-06T22:30:00Z'),
        'Europe/Helsinki',
      ).toISOString(),
    ).toBe('2026-10-06T21:00:00.000Z');
    expect(dayStart(NOW, 'UTC').toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });
});
