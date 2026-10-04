/**
 * Register table for the EASUN ISOLAR SMG-II, transcribed from the vendor's
 * "SMG-RS232 Communication Protocol V1.0.1". Addresses are decimal, as in
 * that document. Reserved, "invalid data" and "internal command" addresses
 * are omitted.
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

  // --- info ---
  // Confirmed by matching an overnight serial capture against the vendor
  // cloud log (2026-10-04). Never polled or read live: here so captures
  // name these addresses.
  {
    name: 'InverterCode', label: 'Inverter code', address: 171, type: 'uint16', group: 'info',
    description: 'Shown by the vendor cloud app as "inverter" (e.g. 3900), which is this value in hexadecimal (0x3900). Likely a model or firmware code.',
  },
  // The protocol requires reading 186-197 as one complete block.
  { name: 'SerialNumber', label: 'Serial number', address: 186, type: 'ascii', length: 12, group: 'info' },

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
  // Descriptions, defaults and program numbers follow the inverter's manual
  // (docs/smg-ii-manual-settings.json); "program NN" is the LCD setting.
  {
    name: 'OutputMode', label: 'Output mode', address: 300, type: 'uint16', group: 'settings', writable: true,
    // The 2-phase modes are listed by the vendor's app after 3-phase P3, so
    // raw 5 and 6 by position; not captured from the device.
    options: ['Single', 'Parallel', '3-phase P1', '3-phase P2', '3-phase P3', '2-phase P1', '2-phase P2'],
    description: 'Whether this inverter runs alone or as part of a parallel or 3-phase system. Maximum discharge current protection (program 46) is only available in Single.',
    risk: 'Parallel, 3-phase and 2-phase modes are selectable but undocumented for this model, and untested. Anything but Single may stop the AC output.',
  },
  {
    name: 'OutputPriority', label: 'Output source priority', address: 301, type: 'uint16', group: 'settings', writable: true,
    // SUB (3) is missing from the protocol PDF; confirmed on the device by a
    // Modbus capture with the inverter's own screen showing SUB.
    options: ['Utility first (UTI)', 'Solar first (SOL)', 'Solar-battery-utility (SBU)', 'Solar-utility-battery (SUB)'],
    panelProgram: '01', default: 0,
    description: 'Which source powers the loads first.',
    optionDescriptions: [
      'Utility powers the loads. Solar and battery power them only when utility is not available.',
      'Solar powers the loads, with the battery helping when solar is not enough. Utility takes over when solar is not available or the battery drops to the low-level warning or the voltage set in program 12.',
      'Solar powers the loads, with the battery helping when solar is not enough. Utility takes over only when the battery drops to the low-level warning or the voltage set in program 12.',
      'Solar charges the battery first, then powers the loads. Utility powers the loads alongside when solar is not enough.',
    ],
  },
  {
    name: 'InputVoltageRange', label: 'AC input voltage range', address: 302, type: 'uint16', group: 'settings', writable: true,
    // Generator (2) is missing from the protocol PDF; confirmed on the device
    // by a Modbus capture with the inverter's own screen showing Generator.
    options: ['Appliances (90-280 V)', 'UPS (170-280 V)', 'Generator (90-280 V)'],
    panelProgram: '03', default: 0,
    description: 'The AC input voltage the inverter accepts from utility or a generator before switching to battery.',
    optionDescriptions: [
      'Appliances: accepts 90-280 VAC, ~20 ms transfer time.',
      'UPS: accepts 170-280 VAC, ~10 ms transfer time.',
      'Generator: accepts 90-280 VAC and tolerates generators. Generators are unstable, so the inverter output may be too.',
    ],
  },
  {
    name: 'BuzzerMode', label: 'Buzzer', address: 303, type: 'uint16', group: 'settings', writable: true,
    // Labels as in the vendor's app; the panel calls them Mode 1-4.
    options: ['Beeps OFF', 'Beeps ON', 'Mute when input source changes', 'Beeps only in fault mode'],
    panelProgram: '18', default: 3,
    description: 'When the buzzer sounds.',
    optionDescriptions: [
      'Panel Mode 1: buzzer muted.',
      'Panel Mode 2: sounds when the input source changes or there is a specific warning or fault.',
      'Panel Mode 3: sounds when there is a specific warning or fault, but not when the input source changes.',
      'Panel Mode 4: sounds only when there is a fault.',
    ],
  },
  // Not in the protocol PDF; read from the device in a Modbus capture.
  {
    name: 'BeepsWhilePrimarySourceInterrupted', label: 'Beep when input source changes', address: 304, type: 'uint16', group: 'settings', writable: true,
    options: ['Beeps OFF', 'Beeps ON'],
    description: 'Controls whether the buzzer beeps when the primary input source is interrupted. This is separate from the buzzer mode setting.',
  },
  {
    name: 'LcdBacklight', label: 'Backlight', address: 305, type: 'uint16', group: 'settings', writable: true,
    options: ['Backlight off (timed)', 'Backlight on'],
    panelProgram: '20', default: 1,
    description: 'Whether the LCD backlight stays on.',
    optionDescriptions: ['Backlight turns off after a while.', 'Backlight stays on.'],
  },
  {
    name: 'LcdAutoReturn', label: 'Auto return to default screen', address: 306, type: 'uint16', group: 'settings', writable: true,
    options: ['Stay at latest screen', 'Return to default screen'],
    panelProgram: '19', default: 1,
    description: 'Whether the LCD goes back to the default screen (input / output voltage) when no button is pressed.',
    optionDescriptions: [
      'Stays at the screen last chosen.',
      'Returns to the default screen after no button is pressed for 1 minute.',
    ],
  },
  {
    name: 'EnergySavingMode', label: 'Energy-saving mode', address: 307, type: 'uint16', group: 'settings', writable: true,
    options: OFF_ON,
    description: 'Energy-saving mode. The manual does not describe it and there is no panel program for it.',
  },
  {
    name: 'OverloadAutoRestart', label: 'Auto restart after overload', address: 308, type: 'uint16', group: 'settings', writable: true,
    options: OFF_ON,
    panelProgram: '06', default: 1,
    description: 'Whether the inverter restarts by itself after shutting down for an overload.',
  },
  {
    name: 'OverTempAutoRestart', label: 'Auto restart after over temperature', address: 309, type: 'uint16', group: 'settings', writable: true,
    options: OFF_ON,
    panelProgram: '07', default: 1,
    description: 'Whether the inverter restarts by itself after shutting down for over temperature.',
  },
  {
    name: 'OverloadTransferToBypass', label: 'Overload bypass', address: 310, type: 'uint16', group: 'settings', writable: true,
    options: DISABLED_ENABLED,
    panelProgram: '23', default: 1,
    description: 'When enabled, the inverter transfers the loads to utility (line mode) if an overload occurs in battery mode.',
  },
  {
    name: 'BatteryEqModeEnabled', label: 'Battery equalization', address: 313, type: 'uint16', group: 'settings', writable: true,
    options: DISABLED_ENABLED,
    panelProgram: '33', default: 0,
    description: 'Periodic equalization charge for flooded lead-acid batteries: reverses acid stratification and sulfation. Settable on the panel only with battery type Flooded or User-Defined. Never equalize lithium batteries.',
  },
  {
    name: 'OutputVoltageSet', label: 'Output voltage', address: 320, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true,
    choices: [220, 230, 240],
    panelProgram: '08', default: 230,
    description: 'The AC output voltage.',
  },
  {
    name: 'OutputFrequencySet', label: 'Output frequency', address: 321, type: 'uint16', scale: 0.01, unit: 'Hz', group: 'settings', writable: true,
    choices: [50, 60],
    panelProgram: '09', default: 50,
    description: 'The AC output frequency.',
  },
  // Not in the protocol PDF (322 is listed as reserved); found in a Modbus
  // capture of the vendor app. Read-only until a capture confirms which raw
  // value each battery type is: the options follow the manual's order, and
  // this unit read 8, which the vendor app shows as unset ("--").
  {
    name: 'BatteryType', label: 'Battery type', address: 322, type: 'uint16', group: 'settings',
    options: ['AGM', 'Flooded', 'User-Defined', 'Lithium without communication'],
    panelProgram: '05', default: 0,
    description: 'The battery type set on the inverter\'s panel. With AGM or Flooded the inverter uses its own charge voltages; bulk, floating and low DC cut-off voltages apply only with User-Defined or Lithium. Change it on the panel.',
  },
  {
    name: 'BatteryOvervoltageProtection', label: 'Battery overvoltage protection', address: 323, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true,
    description: 'Battery voltage at which the inverter stops with fault 03 "battery voltage too high". No panel program; the specification lists 15.5 / 33 / 63 V for 12 / 24 / 48 V models. Keep it above the bulk and equalization voltages.',
    risk: 'Set too low, the inverter stops charging with a fault; set too high, it no longer protects the battery from overcharging.',
  },
  {
    name: 'MaxChargingVoltage', label: 'Bulk charging voltage', address: 324, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true,
    panelProgram: '26', defaultByBatteryVoltage: { 12: 14.1, 24: 28.2, 48: 56.4 },
    description: 'Bulk (constant-voltage) charging voltage. Must be at least the float voltage. Used only when the panel battery type (program 05) is User-Defined or Lithium.',
  },
  {
    name: 'FloatingChargingVoltage', label: 'Floating charging voltage', address: 325, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true,
    panelProgram: '27', defaultByBatteryVoltage: { 12: 13.5, 24: 27, 48: 54 },
    description: 'Float (maintenance) charging voltage, from the nominal battery voltage up to the bulk voltage. Used only when the panel battery type (program 05) is User-Defined or Lithium.',
  },
  {
    name: 'BatteryDischargeRecoveryMains', label: 'Back to battery voltage', address: 326, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true,
    panelProgram: '13',
    description: 'Battery voltage at which the loads go back to battery in Solar first or SBU priority. Must be above the back-to-utility point and at most bulk voltage - 0.4 V. The panel default is "battery fully charged".',
  },
  {
    name: 'BatteryLowVoltageProtectionMains', label: 'Back to utility voltage', address: 327, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true,
    panelProgram: '12', defaultByBatteryVoltage: { 12: 11.5, 24: 23, 48: 46 },
    description: 'Battery voltage at which the loads go back to utility in Solar first or SBU priority. Must be below the back-to-battery point and at least 1 V above the low DC cut-off, or the inverter warns of a low battery.',
  },
  {
    name: 'BatteryLowVoltageProtectionOffGrid', label: 'Low DC cut-off voltage', address: 329, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true,
    panelProgram: '29', defaultByBatteryVoltage: { 12: 10.5, 24: 21, 48: 42 },
    description: 'Low DC cut-off: the inverter stops discharging the battery at this voltage, whatever the load. Must be below the back-to-utility point. For lithium without BMS communication, set it at least 2 V above the BMS discharge protection voltage.',
  },
  // Not in the protocol PDF; read from the device in a Modbus capture.
  {
    name: 'TimeFromCVToFloating', label: 'Time from bulk to floating charge', address: 330, type: 'uint16', group: 'settings', writable: true, unit: 'min',
    description: 'Sets how long the charger stays in the bulk constant-voltage stage before dropping to float charge.',
  },
  {
    name: 'BatteryChargingPriority', label: 'Charger source priority', address: 331, type: 'uint16', group: 'settings', writable: true,
    options: ['Utility first (not on the panel)', 'Solar first (CSO)', 'Solar and utility (SNU)', 'Only solar (OSO)'],
    panelProgram: '16', default: 2,
    description: 'Which sources charge the battery in line, standby or fault mode. In battery mode only solar charges the battery.',
    optionDescriptions: [
      'Utility charges the battery first. Not offered on the panel of this model.',
      'Solar charges the battery first; utility charges only when solar is not available.',
      'Solar and utility charge the battery at the same time.',
      'Only solar charges the battery, whether utility is available or not.',
    ],
  },
  {
    name: 'MaxChargingCurrent', label: 'Max charging current', address: 332, type: 'uint16', scale: 0.1, unit: 'A', group: 'settings', writable: true,
    panelProgram: '02', default: 60,
    description: 'Total charging current from solar and utility together. Must not be less than the max utility charging current. For lithium without BMS communication, keep it below the BMS max charging current.',
  },
  {
    name: 'MaxMainsChargingCurrent', label: 'Max utility charging current', address: 333, type: 'uint16', scale: 0.1, unit: 'A', group: 'settings', writable: true,
    panelProgram: '11', default: 30,
    description: 'Maximum charging current from utility.',
  },
  {
    name: 'EqChargingVoltage', label: 'Battery equalization voltage', address: 334, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true,
    panelProgram: '34', defaultByBatteryVoltage: { 12: 14.6, 24: 29.2, 48: 58.4 },
    description: 'Voltage the battery is held at while equalizing, from the float voltage up to 15.5 / 30 / 62 V. Used only when equalization is enabled.',
  },
  {
    name: 'BatteryEqualizationTime', label: 'Battery equalized time', address: 335, type: 'uint16', unit: 'min', group: 'settings', writable: true, min: 0, max: 900,
    panelProgram: '35', default: 60,
    description: 'How long the battery is held at the equalization voltage once it gets there.',
  },
  {
    name: 'EqualizationTimeoutExit', label: 'Battery equalized timeout', address: 336, type: 'uint16', unit: 'min', group: 'settings', writable: true, min: 0, max: 900,
    panelProgram: '36', default: 120,
    description: 'If the battery has not reached the equalization voltage when the equalization time is up, equalizing continues until this timeout, then returns to float.',
  },
  {
    name: 'TwoEqChargingIntervals', label: 'Equalization interval', address: 337, type: 'uint16', unit: 'days', group: 'settings', writable: true, min: 1, max: 90,
    panelProgram: '37', default: 30,
    description: 'Days between equalization charges. Equalization starts in the float stage when the interval comes round.',
  },
  // Not in the protocol PDF; read from the device in a Modbus capture.
  {
    name: 'AutoACOutput', label: 'Auto AC output', address: 338, type: 'uint16', group: 'settings', writable: true,
    options: ['Disable with power switch OFF', 'Enable with power switch ON'],
    description: 'Controls whether the AC output follows the inverter power switch.',
  },
  // Not in the protocol PDF; read from the device in a Modbus capture.
  {
    name: 'LowDcProtectionSocGrid', label: 'Low DC protection SOC (grid mode)', address: 341, type: 'uint16', group: 'settings', writable: true, unit: '%', min: 0, max: 100,
    description: 'Sets the battery state of charge at which the inverter stops discharging the battery and switches the loads to utility in grid mode.',
  },
  // Not in the protocol PDF; read from the device in a Modbus capture.
  {
    name: 'SocRecoveryMains', label: 'SOC recovery value (mains mode)', address: 342, type: 'uint16', group: 'settings', writable: true, unit: '%', min: 0, max: 100,
    description: 'Sets the battery state of charge at which the inverter returns the loads to battery after a low SOC switch to utility in mains mode.',
  },
  // Not in the protocol PDF; read from the device in a Modbus capture.
  {
    name: 'OffGridSocProtection', label: 'Off-grid battery discharge SOC protection', address: 343, type: 'uint16', group: 'settings', writable: true, unit: '%', min: 0, max: 100,
    description: 'Sets the battery state of charge at which the inverter stops discharging the battery when no utility is available.',
  },
  {
    name: 'TurnOnMode', label: 'Turn-on mode', address: 406, type: 'uint16', group: 'settings', writable: true,
    options: ['Local or remote', 'Local only', 'Remote only'],
    description: 'Where the inverter can be switched on from. No panel program.',
    risk: 'With "Remote only", the inverter\'s own power switch no longer turns it on.',
    optionDescriptions: [
      'The power switch or the remote switch below.',
      'Only the inverter\'s own power switch.',
      'Only the remote switch below; the inverter\'s power switch no longer turns it on.',
    ],
  },
  {
    name: 'RemoteSwitch', label: 'Remote switch', address: 420, type: 'uint16', group: 'settings', writable: true,
    options: ['Off', 'On'],
    description: 'Turns the inverter off or on remotely. No panel program.',
    risk: 'Remote shutdown turns off the inverter\'s AC output: everything it powers loses power until it is turned back on.',
    optionDescriptions: ['Remote shutdown: the AC output turns off.', 'Remote turn-on.'],
  },
  // Not in the protocol PDF (460 is listed as reserved); read from the device
  // in a Modbus capture, matching the vendor app's output ON/OFF toggle.
  {
    name: 'OutputControl', label: 'Output control', address: 460, type: 'uint16', group: 'settings', writable: true,
    options: ['Off', 'On'],
    description: 'Turns the inverter\'s AC output off or on. The vendor\'s app shows it as the main output switch; it may overlap with the remote switch.',
    risk: 'Off turns off the inverter\'s AC output: everything it powers loses power until it is turned back on.',
  },

  // --- commands ---
  {
    name: 'ExitFaultMode', label: 'Exit fault mode', address: 426, type: 'uint16', group: 'command', writable: true,
    choices: [1],
    description: 'Clears the fault state. Works only while the inverter is in fault mode.',
  },

  {
    name: 'RatedPower', label: 'Rated power', address: 643, type: 'uint16', unit: 'W', group: 'settings',
    description: 'The inverter\'s rated output power.',
  },
];
