/**
 * Settings rules for the EASUN ISOLAR SMG-II, from its manual's LCD setting
 * programs and specification (docs/smg-ii-manual-settings.json).
 */
import { SMG_II_REGISTERS } from '../registers/smg-ii.registers.ts';
import type { Bounds, SettingsConstraints, SettingsRule } from './settings-rules.ts';

/** What the rules need to know about the installation. */
export interface InstallationProfile {
  batteryNominalVoltage: number;
  batteryType: string;
}

/** Voltage ranges by nominal battery voltage (manual programs 12-34). */
const VOLTAGE_RANGES: Record<number, Record<string, Bounds>> = {
  12: {
    BatteryOvervoltageProtection: { min: 12, max: 15.5 },
    MaxChargingVoltage: { min: 12, max: 15.5 },
    FloatingChargingVoltage: { min: 12, max: 15.5 },
    BatteryDischargeRecoveryMains: { min: 12, max: 15.5 },
    BatteryLowVoltageProtectionMains: { min: 11, max: 14.3 },
    BatteryLowVoltageProtectionOffGrid: { min: 10, max: 13.5 },
    EqChargingVoltage: { min: 12, max: 15.5 },
  },
  24: {
    BatteryOvervoltageProtection: { min: 24, max: 33 },
    MaxChargingVoltage: { min: 24, max: 30 },
    FloatingChargingVoltage: { min: 24, max: 30 },
    BatteryDischargeRecoveryMains: { min: 24, max: 30 },
    BatteryLowVoltageProtectionMains: { min: 22, max: 28.6 },
    BatteryLowVoltageProtectionOffGrid: { min: 20, max: 27 },
    EqChargingVoltage: { min: 24, max: 30 },
  },
  48: {
    BatteryOvervoltageProtection: { min: 48, max: 63 },
    MaxChargingVoltage: { min: 48, max: 62 },
    FloatingChargingVoltage: { min: 48, max: 62 },
    BatteryDischargeRecoveryMains: { min: 48, max: 62 },
    BatteryLowVoltageProtectionMains: { min: 44, max: 57.2 },
    BatteryLowVoltageProtectionOffGrid: { min: 40, max: 54 },
    EqChargingVoltage: { min: 48, max: 62 },
  },
};

/** Charging currents from the 3.2 kW specification (programs 02, 11). */
const CURRENT_RANGES: Record<string, Bounds> = {
  MaxChargingCurrent: { min: 1, max: 100 },
  MaxMainsChargingCurrent: { min: 2, max: 60 },
};

/** Rules between settings (manual rule ids in docs/smg-ii-manual-settings.json). */
const RULES: SettingsRule[] = [
  {
    id: 'R-VOLT-1', kind: 'compare', severity: 'error',
    left: 'MaxChargingVoltage', op: '>=', right: 'FloatingChargingVoltage',
    message: 'Bulk charging voltage must be at least the float charging voltage',
  },
  {
    id: 'R-EQ-2', kind: 'compare', severity: 'error',
    left: 'EqChargingVoltage', op: '>=', right: 'FloatingChargingVoltage',
    message: 'Equalization voltage must be at least the float charging voltage',
  },
  {
    id: 'R-VOLT-4', kind: 'compare', severity: 'error',
    left: 'BatteryLowVoltageProtectionMains', op: '>', right: 'BatteryLowVoltageProtectionOffGrid',
    message: 'Back-to-utility voltage must be above the low DC cut-off voltage',
  },
  {
    id: 'R-CUR-1', kind: 'compare', severity: 'error',
    left: 'MaxChargingCurrent', op: '>=', right: 'MaxMainsChargingCurrent',
    message: 'Max charging current must be at least the max utility charging current',
  },
  {
    id: 'R-LIB-5', kind: 'compare', severity: 'warning',
    left: 'BatteryLowVoltageProtectionMains', op: '>=', right: 'BatteryLowVoltageProtectionOffGrid', offset: 1,
    message: 'Back-to-utility voltage should be at least 1 V above the low DC cut-off, or the inverter warns of a low battery',
  },
  {
    id: 'R-EQ-3', kind: 'compare', severity: 'warning',
    left: 'EqualizationTimeoutExit', op: '>=', right: 'BatteryEqualizationTime',
    message: 'Equalization timeout is normally at least the equalization time',
  },
  {
    id: 'R-VOLT-6', kind: 'compare', severity: 'warning',
    left: 'BatteryOvervoltageProtection', op: '>', right: 'MaxChargingVoltage',
    message: 'Battery overvoltage protection should be above the bulk charging voltage',
  },
  {
    id: 'R-VOLT-6', kind: 'compare', severity: 'warning',
    left: 'BatteryOvervoltageProtection', op: '>', right: 'EqChargingVoltage',
    message: 'Battery overvoltage protection should be above the equalization voltage',
  },
  // Errors in the manual, warnings here until the device confirms that
  // register 326 is program 13 and how "battery fully charged" reads back.
  {
    id: 'R-VOLT-3', kind: 'compare', severity: 'warning',
    left: 'BatteryDischargeRecoveryMains', op: '>', right: 'BatteryLowVoltageProtectionMains',
    message: 'Back-to-battery voltage should be above the back-to-utility voltage',
  },
  {
    id: 'R-VOLT-5', kind: 'compare', severity: 'warning',
    left: 'BatteryDischargeRecoveryMains', op: '<=', right: 'MaxChargingVoltage', offset: -0.4,
    message: 'Back-to-battery voltage should be at most the bulk charging voltage - 0.4 V',
  },
];

export function settingsConstraints(profile: InstallationProfile): SettingsConstraints {
  const voltage = profile.batteryNominalVoltage;
  const voltageRanges = VOLTAGE_RANGES[voltage];

  const defaults: Record<string, number> = {};
  for (const definition of SMG_II_REGISTERS) {
    if (definition.group !== 'settings') continue;
    const value = definition.defaultByBatteryVoltage?.[voltage] ?? definition.default;
    if (value !== undefined) defaults[definition.name] = value;
  }

  const bounds: Record<string, Bounds> = { ...CURRENT_RANGES };
  for (const [name, range] of Object.entries(voltageRanges ?? {})) {
    bounds[name] = { ...range, context: `for a ${voltage} V battery` };
  }

  return {
    batteryVoltage: voltageRanges ? voltage : null,
    bounds,
    defaults,
    rules: RULES,
  };
}
