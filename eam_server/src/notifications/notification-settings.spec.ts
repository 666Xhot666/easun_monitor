import {
  DEFAULT_SETTINGS,
  mergeSettings,
  sendsToTelegram,
} from './notification-settings';

describe('notification settings', () => {
  it('starts from sending everything to Telegram, and all but the summary in the app', () => {
    expect(DEFAULT_SETTINGS.channels.fault).toEqual({
      inApp: true,
      telegram: true,
    });
    expect(DEFAULT_SETTINGS.channels.summary).toEqual({
      inApp: false,
      telegram: true,
    });
    expect(DEFAULT_SETTINGS.quietHours).toBe(false);
  });

  it('applies a change over what is stored, ignoring unknown kinds and non-booleans', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      channels: {
        grid: { telegram: false },
        nonsense: { telegram: true },
        warning: { inApp: 'yes' },
      },
      quietHours: true,
    });
    expect(merged.channels.grid).toEqual({ inApp: true, telegram: false });
    expect(merged.channels.warning).toEqual({ inApp: true, telegram: true });
    expect(merged.channels).not.toHaveProperty('nonsense');
    expect(merged.quietHours).toBe(true);
  });

  it('sends the outage schedule notices, with a 15 minute lead and confirmed outages only', () => {
    for (const kind of [
      'schedule',
      'outage',
      'schedule-unavailable',
    ] as const) {
      expect(DEFAULT_SETTINGS.channels[kind]).toEqual({
        inApp: true,
        telegram: true,
      });
    }
    expect(DEFAULT_SETTINGS.outageLeadMinutes).toBe(15);
    expect(DEFAULT_SETTINGS.possibleOutages).toBe(false);
  });

  it('takes a lead time of whole minutes from 1 to 120, and the possible outages switch', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      outageLeadMinutes: 30,
      possibleOutages: true,
    });
    expect(merged.outageLeadMinutes).toBe(30);
    expect(merged.possibleOutages).toBe(true);
    for (const wrong of [0, 121, 2.5, '20', null]) {
      expect(
        mergeSettings(merged, { outageLeadMinutes: wrong }).outageLeadMinutes,
      ).toBe(30);
    }
    // Stored before these existed: the defaults.
    const old = mergeSettings({ channels: {}, quietHours: false } as never, {});
    expect(old.outageLeadMinutes).toBe(15);
    expect(old.possibleOutages).toBe(false);
  });

  it('fills in kinds missing from what was stored', () => {
    expect(
      mergeSettings({ channels: {}, quietHours: false } as never, {}).channels
        .battery,
    ).toEqual({ inApp: true, telegram: true });
  });

  describe('sendsToTelegram', () => {
    const quiet = mergeSettings(DEFAULT_SETTINGS, { quietHours: true });
    const at = (hhmm: string) => new Date(`2026-10-07T${hhmm}:00Z`);

    it('follows the Telegram switch of the kind', () => {
      const off = mergeSettings(DEFAULT_SETTINGS, {
        channels: { grid: { telegram: false } },
      });
      expect(sendsToTelegram(off, 'grid', at('12:00'), 'UTC')).toBe(false);
      expect(sendsToTelegram(off, 'fault', at('12:00'), 'UTC')).toBe(true);
    });

    it('holds back all but faults from 23:00 to 07:00 in the given time zone', () => {
      expect(sendsToTelegram(quiet, 'grid', at('23:30'), 'UTC')).toBe(false);
      expect(sendsToTelegram(quiet, 'grid', at('06:59'), 'UTC')).toBe(false);
      expect(sendsToTelegram(quiet, 'grid', at('07:00'), 'UTC')).toBe(true);
      expect(sendsToTelegram(quiet, 'fault', at('03:00'), 'UTC')).toBe(true);
      // 21:30 UTC is 00:30 in Kyiv (UTC+3 in October).
      expect(sendsToTelegram(quiet, 'grid', at('21:30'), 'Europe/Kyiv')).toBe(
        false,
      );
    });
  });
});
