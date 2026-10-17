import { fetchWeather } from './open-meteo';

describe('fetchWeather', () => {
  const reply = {
    hourly: {
      time: ['2026-10-17T11:00', '2026-10-17T12:00'],
      global_tilted_irradiance: [512.5, null],
      cloud_cover: [40, 55],
      temperature_2m: [14.2, 15],
    },
  };

  afterEach(() => jest.restoreAllMocks());

  const answer = (body: unknown, status = 200) =>
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(body), { status })),
      );

  it('asks for the sun on the panel plane, local to the time zone, and reads it per hour', async () => {
    const fetch = answer(reply);

    const hours = await fetchWeather(
      { latitude: 12.3, longitude: -45.7, tiltDeg: 35, facingDeg: 135 },
      'Europe/Lisbon',
    );

    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(
      'https://api.open-meteo.com/v1/forecast',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '12.3',
      longitude: '-45.7',
      hourly: 'global_tilted_irradiance,cloud_cover,temperature_2m',
      tilt: '35',
      azimuth: '-45',
      timezone: 'Europe/Lisbon',
      past_days: '7',
      forecast_days: '2',
    });
    expect(hours).toEqual([
      {
        time: '2026-10-17T11:00',
        irradiance: 512.5,
        cloudCover: 40,
        temperatureC: 14.2,
      },
      {
        time: '2026-10-17T12:00',
        irradiance: null,
        cloudCover: 55,
        temperatureC: 15,
      },
    ]);
  });

  it('assumes a 30° tilt towards the equator when the mounting is not set', async () => {
    const fetch = answer(reply);

    await fetchWeather(
      { latitude: 12.3, longitude: 0, tiltDeg: null, facingDeg: null },
      'UTC',
    );
    await fetchWeather(
      { latitude: -12.3, longitude: 0, tiltDeg: null, facingDeg: null },
      'UTC',
    );

    const params = fetch.mock.calls.map(
      ([url]) => new URL(String(url)).searchParams,
    );
    expect(params.map((p) => [p.get('tilt'), p.get('azimuth')])).toEqual([
      ['30', '0'],
      ['30', '180'],
    ]);
  });

  it('fails when the source does', async () => {
    answer({ error: true, reason: 'bad' }, 400);
    await expect(
      fetchWeather(
        { latitude: 0, longitude: 0, tiltDeg: null, facingDeg: null },
        'UTC',
      ),
    ).rejects.toThrow(/400/);

    jest.restoreAllMocks();
    answer({ hourly: { time: ['x'] } });
    await expect(
      fetchWeather(
        { latitude: 0, longitude: 0, tiltDeg: null, facingDeg: null },
        'UTC',
      ),
    ).rejects.toThrow(/unexpected/);
  });
});
