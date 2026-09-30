/**
 * Register table for the EASUN ISOLAR SMG-II, transcribed from the vendor's
 * "SMG-RS232 Communication Protocol V1.0.1". Addresses are decimal, as in
 * that document. Reserved, "invalid data" and "internal command" addresses
 * are omitted, as is 426 "Exit the fault mode" (a write-only command).
 *
 * Names are the keys stored in every reading, so renaming one orphans its
 * history.
 */
import type { RegisterDefinition } from './register-map.ts';

const OFF_ON = ['Off', 'On'];
const DISABLED_ENABLED = ['Disabled', 'Enabled'];

/** Fault code table: fault code n corresponds to bit n. */
const FAULT_BITS: Record<number, string> = {
  1: 'Inverter module over temperature',
  2: 'DC-DC module over temperature',
  3: 'Battery over voltage',
  4: 'PV module over temperature',
  5: 'Output short circuit',
  6: 'Inverter over voltage',
  7: 'Output overload',
  8: 'Bus over voltage',
  9: 'Bus soft start timed out',
  10: 'PV over current',
  11: 'PV over voltage',
  12: 'Battery over current',
  13: 'Inverter over current',
  14: 'Bus low voltage',
  16: 'Inverter DC component too high',
  18: 'Output current zero bias too large',
  19: 'Inverter current zero bias too large',
  20: 'Battery current zero bias too large',
  21: 'PV current zero bias too large',
  22: 'Inverter low voltage',
  23: 'Inverter negative power protection',
  24: 'Parallel system host lost',
  25: 'Parallel system synchronization signal abnormal',
  26: 'Battery type incompatible',
  27: 'Parallel versions incompatible',
};

/** Warning code table: one warning per bit. */
const WARNING_BITS: Record<number, string> = {
  1: 'Mains waveform abnormal',
  3: 'Mains low voltage',
  4: 'Mains over frequency',
  5: 'Mains low frequency',
  6: 'PV low voltage',
  7: 'Over temperature',
  8: 'Battery low voltage',
  9: 'Battery not connected',
  10: 'Overload',
  11: 'Battery equalization charging',
  12: 'Battery discharged at low voltage, not yet recharged to the recovery point',
  13: 'Output power derating',
  14: 'Fan blocked',
  15: 'PV energy too low to use',
  16: 'Parallel communication interrupted',
  17: 'Single and parallel output modes inconsistent',
  18: 'Parallel battery voltage difference too large',
};

export const SMG_II_REGISTERS: readonly RegisterDefinition[] = [
  // --- status ---
  { name: 'FaultCode', label: 'Faults', address: 100, type: 'uint32', group: 'status', bits: FAULT_BITS },
  { name: 'WarningCode', label: 'Warnings', address: 108, type: 'uint32', group: 'status', bits: WARNING_BITS },

  // --- telemetry ---
  { name: 'OperationMode', label: 'Operating mode', address: 201, type: 'uint16', options: ['Power on', 'Standby', 'Mains', 'Off-grid', 'Bypass', 'Charging', 'Fault'], group: 'telemetry' },
  { name: 'MainsVoltage', label: 'Mains voltage', address: 202, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'MainsFrequency', label: 'Mains frequency', address: 203, type: 'int16', scale: 0.01, unit: 'Hz', group: 'telemetry' },
  { name: 'AverageMainsPower', label: 'Mains power', address: 204, type: 'int16', unit: 'W', group: 'telemetry' },
  { name: 'InverterVoltage', label: 'Inverter voltage', address: 205, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'InverterCurrent', label: 'Inverter current', address: 206, type: 'int16', scale: 0.1, unit: 'A', group: 'telemetry' },
  { name: 'InverterFrequency', label: 'Inverter frequency', address: 207, type: 'int16', scale: 0.01, unit: 'Hz', group: 'telemetry' },
  { name: 'AverageInverterPower', label: 'Inverter power', address: 208, type: 'int16', unit: 'W', group: 'telemetry' },
  { name: 'InverterChargingPower', label: 'Inverter charging power', address: 209, type: 'int16', unit: 'W', group: 'telemetry' },
  { name: 'OutputVoltage', label: 'Output voltage', address: 210, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'OutputCurrent', label: 'Output current', address: 211, type: 'int16', scale: 0.1, unit: 'A', group: 'telemetry' },
  { name: 'OutputFrequency', label: 'Output frequency', address: 212, type: 'int16', scale: 0.01, unit: 'Hz', group: 'telemetry' },
  { name: 'OutputActivePower', label: 'Output active power', address: 213, type: 'int16', unit: 'W', group: 'telemetry' },
  { name: 'OutputApparentPower', label: 'Output apparent power', address: 214, type: 'int16', unit: 'VA', group: 'telemetry' },
  { name: 'BatteryVoltage', label: 'Battery voltage', address: 215, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'BatteryCurrent', label: 'Battery current', address: 216, type: 'int16', scale: 0.1, unit: 'A', group: 'telemetry' },
  { name: 'BatteryPower', label: 'Battery power', address: 217, type: 'int16', unit: 'W', group: 'telemetry' },
  { name: 'PVVoltage', label: 'PV voltage', address: 219, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'PVCurrent', label: 'PV current', address: 220, type: 'int16', scale: 0.1, unit: 'A', group: 'telemetry' },
  { name: 'PVPower', label: 'PV power', address: 223, type: 'int16', unit: 'W', group: 'telemetry' },
  { name: 'PVChargingPower', label: 'PV charging power', address: 224, type: 'int16', unit: 'W', group: 'telemetry' },
  { name: 'LoadPercentage', label: 'Load', address: 225, type: 'int16', unit: '%', group: 'telemetry' },
  { name: 'DCDCTemperature', label: 'DC-DC temperature', address: 226, type: 'int16', unit: '°C', group: 'telemetry' },
  { name: 'InverterTemperature', label: 'Inverter temperature', address: 227, type: 'int16', unit: '°C', group: 'telemetry' },
  { name: 'BatterySoc', label: 'Battery state of charge', address: 229, type: 'uint16', unit: '%', group: 'telemetry' },
  { name: 'BatteryCurrentSigned', label: 'Battery current (+charge / -discharge)', address: 232, type: 'int16', scale: 0.1, unit: 'A', group: 'telemetry' },
  { name: 'InverterChargingCurrent', label: 'Inverter charging current', address: 233, type: 'int16', scale: 0.1, unit: 'A', group: 'telemetry' },
  { name: 'PVChargingCurrent', label: 'PV charging current', address: 234, type: 'int16', scale: 0.1, unit: 'A', group: 'telemetry' },

  // --- settings ---
  { name: 'OutputMode', label: 'Output mode', address: 300, type: 'uint16', options: ['Single', 'Parallel', '3-phase P1', '3-phase P2', '3-phase P3'], group: 'settings', writable: true },
  { name: 'OutputPriority', label: 'Output priority', address: 301, type: 'uint16', options: ['Utility first (UTI)', 'Solar first (SOL)', 'Solar-battery-utility (SBU)'], group: 'settings', writable: true },
  { name: 'InputVoltageRange', label: 'Input voltage range', address: 302, type: 'uint16', options: ['Wide', 'Narrow'], group: 'settings', writable: true },
  { name: 'BuzzerMode', label: 'Buzzer', address: 303, type: 'uint16', options: ['Mute', 'Source change, warning or fault', 'Warning or fault', 'Fault only'], group: 'settings', writable: true },
  { name: 'LcdBacklight', label: 'LCD backlight', address: 305, type: 'uint16', options: ['Timed off', 'Always on'], group: 'settings', writable: true },
  { name: 'LcdAutoReturn', label: 'LCD returns to home page', address: 306, type: 'uint16', options: ['Off', 'After 1 minute'], group: 'settings', writable: true },
  { name: 'EnergySavingMode', label: 'Energy-saving mode', address: 307, type: 'uint16', options: OFF_ON, group: 'settings', writable: true },
  { name: 'OverloadAutoRestart', label: 'Restart after overload', address: 308, type: 'uint16', options: OFF_ON, group: 'settings', writable: true },
  { name: 'OverTempAutoRestart', label: 'Restart after over temperature', address: 309, type: 'uint16', options: OFF_ON, group: 'settings', writable: true },
  { name: 'OverloadTransferToBypass', label: 'Transfer to bypass on overload', address: 310, type: 'uint16', options: DISABLED_ENABLED, group: 'settings', writable: true },
  { name: 'BatteryEqModeEnabled', label: 'Battery equalization', address: 313, type: 'uint16', options: DISABLED_ENABLED, group: 'settings', writable: true },
  { name: 'OutputVoltageSet', label: 'Output voltage', address: 320, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'OutputFrequencySet', label: 'Output frequency', address: 321, type: 'uint16', scale: 0.01, unit: 'Hz', group: 'settings', writable: true },
  { name: 'BatteryOvervoltageProtection', label: 'Battery overvoltage protection', address: 323, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'MaxChargingVoltage', label: 'Max charging voltage (bulk)', address: 324, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'FloatingChargingVoltage', label: 'Float charging voltage', address: 325, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'BatteryDischargeRecoveryMains', label: 'Discharge recovery point (mains mode)', address: 326, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'BatteryLowVoltageProtectionMains', label: 'Low-voltage protection (mains mode)', address: 327, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'BatteryLowVoltageProtectionOffGrid', label: 'Low-voltage protection (off-grid mode)', address: 329, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'BatteryChargingPriority', label: 'Charging priority', address: 331, type: 'uint16', options: ['Utility first', 'PV first', 'PV and utility', 'PV only'], group: 'settings', writable: true },
  { name: 'MaxChargingCurrent', label: 'Max charging current', address: 332, type: 'uint16', scale: 0.1, unit: 'A', group: 'settings', writable: true },
  { name: 'MaxMainsChargingCurrent', label: 'Max mains charging current', address: 333, type: 'uint16', scale: 0.1, unit: 'A', group: 'settings', writable: true },
  { name: 'EqChargingVoltage', label: 'Equalization voltage', address: 334, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'BatteryEqualizationTime', label: 'Equalization time', address: 335, type: 'uint16', unit: 'min', group: 'settings', writable: true, min: 0, max: 900 },
  { name: 'EqualizationTimeoutExit', label: 'Equalization timeout', address: 336, type: 'uint16', unit: 'min', group: 'settings', writable: true, min: 0, max: 900 },
  { name: 'TwoEqChargingIntervals', label: 'Equalization interval', address: 337, type: 'uint16', unit: 'days', group: 'settings', writable: true, min: 1, max: 90 },
  { name: 'TurnOnMode', label: 'Turn-on mode', address: 406, type: 'uint16', options: ['Local or remote', 'Local only', 'Remote only'], group: 'settings', writable: true },
  { name: 'RemoteSwitch', label: 'Remote switch', address: 420, type: 'uint16', options: ['Off', 'On'], group: 'settings', writable: true },
  { name: 'RatedPower', label: 'Rated power', address: 643, type: 'uint16', unit: 'W', group: 'settings' },
];
