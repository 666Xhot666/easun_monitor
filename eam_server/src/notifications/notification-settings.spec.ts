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
