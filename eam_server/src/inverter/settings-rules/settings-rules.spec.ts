import { checkSettings } from './settings-rules';
import { settingsConstraints } from './smg-ii.settings-rules';

const profile = (batteryNominalVoltage: number, batteryType = 'LEAD_ACID') => ({
  batteryNominalVoltage,
  batteryType,
});

describe('SMG-II settings constraints', () => {
  it('limits voltages to the manual ranges for the battery voltage', () => {
    const c24 = settingsConstraints(profile(24));
    expect(c24.batteryVoltage).toBe(24);
    expect(c24.bounds.MaxChargingVoltage).toMatchObject({ min: 24, max: 30 });
    expect(c24.bounds.BatteryLowVoltageProtectionMains).toMatchObject({ min: 22, max: 28.6 });
    expect(c24.bounds.BatteryLowVoltageProtectionOffGrid).toMatchObject({ min: 20, max: 27 });

    const c48 = settingsConstraints(profile(48));
    expect(c48.bounds.MaxChargingVoltage).toMatchObject({ min: 48, max: 62 });
    expect(c48.bounds.BatteryOvervoltageProtection).toMatchObject({ min: 48, max: 63 });
  });

  it('limits charging currents to the 3.2 kW specification', () => {
    const c = settingsConstraints(profile(24));
    expect(c.bounds.MaxChargingCurrent).toEqual({ min: 1, max: 100 });
    expect(c.bounds.MaxMainsChargingCurrent).toEqual({ min: 2, max: 60 });
  });

  it('resolves battery-voltage defaults', () => {
    expect(settingsConstraints(profile(24)).defaults).toMatchObject({
      MaxChargingVoltage: 28.2,
      FloatingChargingVoltage: 27,
      BatteryLowVoltageProtectionOffGrid: 21,
    });
  });

  it('leaves voltages unbounded for a battery voltage the manual does not cover', () => {
    const c = settingsConstraints(profile(36));
    expect(c.batteryVoltage).toBeNull();
    expect(c.bounds.MaxChargingVoltage).toBeUndefined();
    expect(c.bounds.MaxMainsChargingCurrent).toEqual({ min: 2, max: 60 });
    expect(c.defaults.MaxChargingVoltage).toBeUndefined();
  });
});

describe('checkSettings', () => {
  const c24 = settingsConstraints(profile(24));
  const current = {
    MaxChargingVoltage: 28.2,
    FloatingChargingVoltage: 27,
    BatteryDischargeRecoveryMains: 26,
    BatteryLowVoltageProtectionMains: 23,
    BatteryLowVoltageProtectionOffGrid: 21,
    MaxChargingCurrent: 60,
    MaxMainsChargingCurrent: 30,
  };

  it('accepts changes within range', () => {
    expect(checkSettings(c24, current, { MaxChargingVoltage: 29 })).toEqual({ errors: {}, warnings: {}, inactive: {} });
  });

  it('rejects a change outside the range for the battery', () => {
    expect(checkSettings(c24, current, { MaxChargingVoltage: 56.4 }).errors).toEqual({
      MaxChargingVoltage: ['Must be between 24 and 30 for a 24 V battery'],
    });
    expect(checkSettings(c24, current, { MaxMainsChargingCurrent: 80 }).errors).toEqual({
      MaxMainsChargingCurrent: ['Must be between 2 and 60'],
    });
  });

  it('does not hold an unchanged out-of-range value against an unrelated change', () => {
    expect(checkSettings(c24, { ...current, MaxChargingVoltage: 56.4 }, { MaxMainsChargingCurrent: 20 }).errors).toEqual({});
  });
});
