import { settingsConstraints } from './smg-ii.settings-rules';

const profile = (batteryNominalVoltage: number, batteryType = 'LEAD_ACID') => ({
  batteryNominalVoltage,
  batteryType,
});

describe('SMG-II settings constraints', () => {
  it('limits voltages to the manual ranges for the battery voltage', () => {
    const c24 = settingsConstraints(profile(24));
    expect(c24.batteryVoltage).toBe(24);
    expect(c24.bounds.MaxChargingVoltage).toEqual({ min: 24, max: 30 });
    expect(c24.bounds.BatteryLowVoltageProtectionMains).toEqual({ min: 22, max: 28.6 });
    expect(c24.bounds.BatteryLowVoltageProtectionOffGrid).toEqual({ min: 20, max: 27 });

    const c48 = settingsConstraints(profile(48));
    expect(c48.bounds.MaxChargingVoltage).toEqual({ min: 48, max: 62 });
    expect(c48.bounds.BatteryOvervoltageProtection).toEqual({ min: 48, max: 63 });
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
