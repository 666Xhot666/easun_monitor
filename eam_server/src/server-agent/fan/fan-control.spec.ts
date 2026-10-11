import { fanTarget, levelOf, toPwm, type FanSettings } from './fan-control';

const auto = (over: Partial<FanSettings> = {}): FanSettings => ({
  mode: 'AUTO',
  minPercent: 0,
  manualPercent: 100,
  rules: [
    { aboveC: 60, percent: 30 },
    { aboveC: 80, percent: 100 },
  ],
  ...over,
});

describe('fanTarget', () => {
  it('leaves the fan to the firmware', () => {
    expect(fanTarget(auto({ mode: 'FIRMWARE' }), 90, null)).toEqual({
      mode: 'firmware',
    });
  });

  it('holds the manual speed whatever the temperature', () => {
    expect(
      fanTarget(auto({ mode: 'MANUAL', manualPercent: 40 }), 95, null),
    ).toEqual({
      mode: 'manual',
      percent: 40,
      rule: null,
    });
  });

  it('follows the highest rule the temperature is above, never below the minimum', () => {
    expect(fanTarget(auto(), 50, null)).toEqual({
      mode: 'manual',
      percent: 0,
      rule: null,
    });
    expect(fanTarget(auto(), 61, null)).toEqual({
      mode: 'manual',
      percent: 30,
      rule: 60,
    });
    expect(fanTarget(auto(), 85, null)).toEqual({
      mode: 'manual',
      percent: 100,
      rule: 80,
    });
    expect(fanTarget(auto({ minPercent: 40 }), 61, null)).toEqual({
      mode: 'manual',
      percent: 40,
      rule: 60,
    });
    expect(fanTarget(auto({ minPercent: 25 }), 20, null)).toEqual({
      mode: 'manual',
      percent: 25,
      rule: null,
    });
  });

  it('steps down only once the temperature is 3 °C below the rule it is on', () => {
    const high = fanTarget(auto(), 85, null);
    // 79 °C: under 80 but not by 3 °C yet.
    expect(fanTarget(auto(), 79, high)).toEqual(high);
    expect(fanTarget(auto(), 77, high)).toEqual({
      mode: 'manual',
      percent: 30,
      rule: 60,
    });
    // Stepping up is at once.
    const mid = fanTarget(auto(), 70, null);
    expect(fanTarget(auto(), 80.5, mid)).toEqual({
      mode: 'manual',
      percent: 100,
      rule: 80,
    });
  });

  it('runs at full speed when no temperature can be read', () => {
    expect(fanTarget(auto(), null, null)).toEqual({
      mode: 'manual',
      percent: 100,
      rule: null,
    });
  });
});

describe('fan speeds', () => {
  it('writes the percentage as PWM, snapped to the speeds the fan has', () => {
    expect(toPwm(0, null)).toBe(0);
    expect(toPwm(50, null)).toBe(128);
    expect(toPwm(100, null)).toBe(255);
    // A fan with three speeds: off, low, high.
    expect([0, 24, 25, 74, 75, 100].map((p) => toPwm(p, 3))).toEqual([
      0, 0, 128, 128, 255, 255,
    ]);
  });

  it('says which speed a percentage gives', () => {
    expect([0, 24, 25, 74, 75, 100].map((p) => levelOf(p, 3))).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
    expect(levelOf(37, null)).toBeNull();
  });
});
