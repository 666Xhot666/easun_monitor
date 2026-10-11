import { outageReaderConfig } from './config';

const required = {
  OUTAGE_SERVER_URL: 'http://localhost:3000',
  OUTAGE_READER_TOKEN: 'tok',
};

describe('outageReaderConfig', () => {
  it('has defaults for everything but the server and token', () => {
    expect(outageReaderConfig(required)).toEqual({
      server: { url: 'http://localhost:3000', token: 'tok' },
      cadence: {
        intervalMinutes: 120,
        eveningIntervalMinutes: 30,
        evening: { from: 18 * 60, to: 23 * 60 },
        blockedHours: 6,
      },
      browserEveryDays: 7,
      stateFile: '.outage-reader-state.json',
    });
  });

  it('reads every setting', () => {
    expect(
      outageReaderConfig({
        ...required,
        OUTAGE_INTERVAL_MINUTES: '180',
        OUTAGE_EVENING_INTERVAL_MINUTES: '20',
        OUTAGE_EVENING: '17:30-22:00',
        OUTAGE_BLOCKED_HOURS: '12',
        OUTAGE_BROWSER_EVERY_DAYS: '3',
        OUTAGE_STATE_FILE: '/var/lib/easun/outage.json',
      }),
    ).toMatchObject({
      cadence: {
        intervalMinutes: 180,
        eveningIntervalMinutes: 20,
        evening: { from: 17 * 60 + 30, to: 22 * 60 },
        blockedHours: 12,
      },
      browserEveryDays: 3,
      stateFile: '/var/lib/easun/outage.json',
    });
  });

  it('needs the server address and the token from the app', () => {
    expect(() => outageReaderConfig({ OUTAGE_READER_TOKEN: 'tok' })).toThrow(
      /OUTAGE_SERVER_URL/,
    );
    expect(() => outageReaderConfig({ OUTAGE_SERVER_URL: 'http://x' })).toThrow(
      /OUTAGE_READER_TOKEN/,
    );
  });

  it('refuses intervals that would hammer the site, and a malformed evening', () => {
    expect(() =>
      outageReaderConfig({ ...required, OUTAGE_INTERVAL_MINUTES: '5' }),
    ).toThrow(/OUTAGE_INTERVAL_MINUTES/);
    expect(() =>
      outageReaderConfig({ ...required, OUTAGE_EVENING_INTERVAL_MINUTES: '1' }),
    ).toThrow(/OUTAGE_EVENING_INTERVAL_MINUTES/);
    expect(() =>
      outageReaderConfig({ ...required, OUTAGE_EVENING: '18-23' }),
    ).toThrow(/OUTAGE_EVENING/);
    expect(() =>
      outageReaderConfig({ ...required, OUTAGE_EVENING: '23:00-18:00' }),
    ).toThrow(/OUTAGE_EVENING/);
  });
});
