import { describe, expect, it } from 'vitest';
import { proposeLithiumSettings } from './lithiumSetup';

describe('proposeLithiumSettings', () => {
  it("follows the manual's steps for a lithium battery without BMS communication", () => {
    // A 24 V LiFePO4 pack: BMS charges to 29.2 V at up to 100 A, cuts off at 20.0 V.
    expect(
      proposeLithiumSettings({ maxChargingVoltage: 29.2, maxChargingCurrent: 100, dischargeProtectionVoltage: 20 }),
    ).toEqual({
      MaxChargingVoltage: 28.7, // BMS max - 0.5 V
      FloatingChargingVoltage: 28.7, // = bulk
      BatteryLowVoltageProtectionOffGrid: 22, // BMS discharge protection + 2 V
      BatteryLowVoltageProtectionMains: 23, // cut-off + 1 V
      MaxChargingCurrent: 99, // below the BMS max
    });
  });

  it('rounds to the 0.1 V resolution of the inverter', () => {
    expect(
      proposeLithiumSettings({ maxChargingVoltage: 28.85, maxChargingCurrent: 50.5, dischargeProtectionVoltage: 21.07 }),
    ).toMatchObject({
      MaxChargingVoltage: 28.3,
      BatteryLowVoltageProtectionOffGrid: 23.1,
      BatteryLowVoltageProtectionMains: 24.1,
      MaxChargingCurrent: 50,
    });
  });
});
