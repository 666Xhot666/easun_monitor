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
    expect(checkSettings(c24, current, { MaxMainsChargingCurrent: 1 }).errors).toEqual({
      MaxMainsChargingCurrent: ['Must be between 2 and 60'],
    });
  });

  it('does not hold an unchanged out-of-range value against an unrelated change', () => {
    expect(checkSettings(c24, { ...current, MaxChargingVoltage: 56.4 }, { MaxMainsChargingCurrent: 20 }).errors).toEqual({});
  });

  it('flags a change that contradicts another setting on both settings', () => {
    const message = 'Bulk charging voltage must be at least the float charging voltage';
    expect(checkSettings(c24, current, { MaxChargingVoltage: 26.5 }).errors).toEqual({
      MaxChargingVoltage: [message],
      FloatingChargingVoltage: [message],
    });
    expect(checkSettings(c24, current, { MaxMainsChargingCurrent: 50, MaxChargingCurrent: 40 }).errors).toEqual({
      MaxChargingCurrent: ['Max charging current must be at least the max utility charging current'],
      MaxMainsChargingCurrent: ['Max charging current must be at least the max utility charging current'],
    });
  });

  it('checks a contradiction against the edited values, not the old ones', () => {
    expect(checkSettings(c24, current, { MaxChargingVoltage: 26.5, FloatingChargingVoltage: 26.5 }).errors).toEqual({});
  });

  it('enforces the order of the battery switching points', () => {
    expect(checkSettings(c24, current, { BatteryLowVoltageProtectionOffGrid: 23.5 }).errors).toEqual({
      BatteryLowVoltageProtectionMains: ['Back-to-utility voltage must be above the low DC cut-off voltage'],
      BatteryLowVoltageProtectionOffGrid: ['Back-to-utility voltage must be above the low DC cut-off voltage'],
    });
  });

  it('skips rules whose other setting was not read', () => {
    const { FloatingChargingVoltage: _, ...withoutFloat } = current;
    expect(checkSettings(c24, withoutFloat, { MaxChargingVoltage: 26.5 }).errors).toEqual({});
  });

  it('warns about combinations the inverter accepts but the manual advises against', () => {
    const check = checkSettings(c24, current, { BatteryLowVoltageProtectionOffGrid: 22.5 });
    expect(check.errors).toEqual({});
    expect(check.warnings.BatteryLowVoltageProtectionMains).toEqual([
      'Back-to-utility voltage should be at least 1 V above the low DC cut-off, or the inverter warns of a low battery',
    ]);

    expect(checkSettings(c24, { ...current, BatteryEqualizationTime: 60 }, { EqualizationTimeoutExit: 30 }).warnings).toEqual({
      BatteryEqualizationTime: ['Equalization timeout is normally at least the equalization time'],
      EqualizationTimeoutExit: ['Equalization timeout is normally at least the equalization time'],
    });
  });

  it('warns when overvoltage protection would trip during charging', () => {
    expect(checkSettings(c24, { ...current, BatteryOvervoltageProtection: 33 }, { MaxChargingVoltage: 30, BatteryOvervoltageProtection: 29 }).warnings.BatteryOvervoltageProtection).toEqual([
      'Battery overvoltage protection should be above the bulk charging voltage',
    ]);
  });

  it('only warns about the back-to-battery point until its register mapping is confirmed', () => {
    const check = checkSettings(c24, current, { BatteryDischargeRecoveryMains: 24.5, BatteryLowVoltageProtectionMains: 25 });
    expect(check.errors).toEqual({});
    expect(check.warnings.BatteryDischargeRecoveryMains).toEqual([
      'Back-to-battery voltage should be above the back-to-utility voltage',
    ]);
    expect(checkSettings(c24, current, { BatteryDischargeRecoveryMains: 28 }).warnings.BatteryDischargeRecoveryMains).toEqual([
      'Back-to-battery voltage should be at most the bulk charging voltage - 0.4 V',
    ]);
  });

  it('marks settings that have no effect in the current state, edits included', () => {
    const eqOff = { ...current, BatteryEqModeEnabled: 0, OutputPriority: 0 };
    expect(checkSettings(c24, eqOff, {}).inactive).toEqual({
      EqChargingVoltage: 'Only used while battery equalization is enabled',
      BatteryEqualizationTime: 'Only used while battery equalization is enabled',
      EqualizationTimeoutExit: 'Only used while battery equalization is enabled',
      TwoEqChargingIntervals: 'Only used while battery equalization is enabled',
      BatteryDischargeRecoveryMains: 'Only used with output priority Solar first or SBU',
      BatteryLowVoltageProtectionMains: 'Only used with output priority Solar first or SBU',
    });
    expect(checkSettings(c24, eqOff, { BatteryEqModeEnabled: 1, OutputPriority: 2 }).inactive).toEqual({});
  });

  it('warns against equalizing a lithium battery', () => {
    const lithium = settingsConstraints(profile(24, 'LIFEPO4'));
    expect(checkSettings(lithium, current, { BatteryEqModeEnabled: 1 }).warnings).toEqual({
      BatteryEqModeEnabled: ['Never equalize a lithium battery'],
    });
    expect(checkSettings(c24, current, { BatteryEqModeEnabled: 1 }).warnings).toEqual({});
  });
});
