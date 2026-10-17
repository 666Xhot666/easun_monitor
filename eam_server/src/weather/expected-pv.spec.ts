import { expectedDays, expectedPowerW, type WeatherHour } from './expected-pv';

const hour = (overrides: Partial<WeatherHour> = {}): WeatherHour => ({
  time: '2026-10-17T12:00',
  irradiance: 1000,
  cloudCover: 0,
  temperatureC: 25 - 1000 * (25 / 800),
  ...overrides,
});

const array = { powerW: 2700, maxInputW: null };

describe('expectedPowerW', () => {
  it('is the rated power times the sun and the performance ratio at 25 °C cells', () => {
    expect(expectedPowerW(hour(), array)).toBe(2160);
    expect(
      expectedPowerW(
        hour({ irradiance: 500, temperatureC: 25 - 500 * (25 / 800) }),
        array,
      ),
    ).toBe(1080);
  });

  it('loses 0.4 % per degree the cells run above 25 °C', () => {
    expect(expectedPowerW(hour({ temperatureC: 25 }), array)).toBe(1890);
  });

  it("is capped by the inverter's PV input", () => {
    expect(expectedPowerW(hour(), { powerW: 2700, maxInputW: 2000 })).toBe(
      2000,
    );
  });

  it('is 0 at night and unknown without irradiance', () => {
    expect(expectedPowerW(hour({ irradiance: 0 }), array)).toBe(0);
    expect(expectedPowerW(hour({ irradiance: null }), array)).toBeNull();
  });
});

describe('expectedDays', () => {
  it("sums each local day's hours, with the daylight cloud cover", () => {
    const days = expectedDays(
      [
        hour({ time: '2026-10-17T06:00', irradiance: 0, cloudCover: 100 }),
        hour({ time: '2026-10-17T12:00', cloudCover: 20 }),
        hour({ time: '2026-10-17T13:00', cloudCover: 40 }),
        hour({ time: '2026-10-18T12:00', irradiance: null }),
      ],
      array,
    );

    expect(days).toEqual([
      { date: '2026-10-17', expectedKWh: 4.32, cloudCover: 30 },
      { date: '2026-10-18', expectedKWh: null, cloudCover: null },
    ]);
  });
});
