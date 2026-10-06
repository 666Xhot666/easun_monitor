import { describe, expect, it } from 'vitest';
import type { RegisterDefinition } from '../inverter/types';
import { collectChanges, groupIntoSections, toFormValues } from './settingsForm';

const defs: RegisterDefinition[] = [
  { name: 'OutputPriority', label: 'Output priority', address: 301, type: 'uint16', group: 'settings', writable: true, options: ['UTI', 'SOL', 'SBU'] },
  { name: 'OutputVoltageSet', label: 'Output voltage', address: 320, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'MaxChargingCurrent', label: 'Max charging current', address: 332, type: 'uint16', scale: 0.1, unit: 'A', group: 'settings', writable: true },
  { name: 'BatteryEqualizationTime', label: 'Equalization time', address: 335, type: 'uint16', unit: 'min', group: 'settings', writable: true, min: 0, max: 900 },
  { name: 'TurnOnMode', label: 'Turn-on mode', address: 406, type: 'uint16', group: 'settings', writable: true, options: ['A', 'B', 'C'] },
  { name: 'RatedPower', label: 'Rated power', address: 643, type: 'uint16', unit: 'W', group: 'settings' },
  { name: 'MainsVoltage', label: 'Mains voltage', address: 202, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
];

describe('toFormValues', () => {
  it('turns settings values into form strings at the register resolution', () => {
    expect(toFormValues(defs, { OutputPriority: 2, OutputVoltageSet: 230, BatteryEqualizationTime: 120, RatedPower: 3200 })).toEqual({
      OutputPriority: '2',
      OutputVoltageSet: '230.0',
      MaxChargingCurrent: '',
      BatteryEqualizationTime: '120',
      TurnOnMode: '',
      RatedPower: '3200',
    });
  });
});

describe('collectChanges', () => {
  const original = toFormValues(defs, { OutputPriority: 2, OutputVoltageSet: 230, BatteryEqualizationTime: 120 });

  it('returns only edited, writable fields as numbers', () => {
    const form = { ...original, OutputPriority: '0', OutputVoltageSet: '220.5', RatedPower: '9999' };
    expect(collectChanges(defs, original, form)).toEqual({
      changes: { OutputPriority: 0, OutputVoltageSet: 220.5 },
      errors: {},
    });
  });

  it('ignores edits that do not change the value', () => {
    expect(collectChanges(defs, original, { ...original, OutputVoltageSet: '230' }).changes).toEqual({});
  });

  it('explains values the inverter would refuse', () => {
    const form = {
      ...original,
      OutputVoltageSet: 'abc',
      MaxChargingCurrent: '60.25',
      BatteryEqualizationTime: '901',
    };
    expect(collectChanges(defs, original, form).errors).toEqual({
      OutputVoltageSet: 'Enter a number',
      MaxChargingCurrent: 'Use steps of 0.1 A',
      BatteryEqualizationTime: 'Must be between 0 and 900 min',
    });
  });
});

describe('groupIntoSections', () => {
  it('groups settings registers into titled sections', () => {
    const sections = groupIntoSections(defs);
    expect(sections.map((s) => [s.title, s.registers.map((r) => r.name)])).toEqual([
      ['Output and source priority', ['OutputPriority', 'OutputVoltageSet']],
      ['Battery and charging', ['MaxChargingCurrent']],
      ['Equalization', ['BatteryEqualizationTime']],
      ['Power on/off and energy saving', ['TurnOnMode']],
      ['Device information', ['RatedPower']],
    ]);
  });

  it('places risky settings with their related settings, no Advanced section', () => {
    const risky = (name: string, address: number): RegisterDefinition => ({
      name, label: name, address, type: 'uint16', group: 'settings', writable: true, risk: 'Cuts power',
    });
    const sections = groupIntoSections([
      ...defs.filter((d) => d.name !== 'TurnOnMode'),
      risky('OutputMode', 300),
      risky('BatteryOvervoltageProtection', 323),
      risky('TurnOnMode', 406),
      risky('RemoteSwitch', 420),
      risky('OutputControl', 460),
    ]);
    expect(sections.map((s) => [s.title, s.registers.map((r) => r.name)])).toEqual([
      ['Output and source priority', ['OutputMode', 'OutputPriority', 'OutputVoltageSet']],
      ['Battery and charging', ['MaxChargingCurrent', 'BatteryOvervoltageProtection']],
      ['Equalization', ['BatteryEqualizationTime']],
      ['Power on/off and energy saving', ['TurnOnMode', 'RemoteSwitch', 'OutputControl']],
      ['Device information', ['RatedPower']],
    ]);
  });

  it('places the settings found on the device with their related settings', () => {
    const setting = (name: string, address: number): RegisterDefinition => ({
      name, label: name, address, type: 'uint16', group: 'settings', writable: true,
    });
    const sections = groupIntoSections([
      setting('BeepsWhilePrimarySourceInterrupted', 304),
      setting('TimeFromCVToFloating', 330),
      setting('AutoACOutput', 338),
      setting('LowDcProtectionSocGrid', 341),
      setting('SocRecoveryMains', 342),
      setting('OffGridSocProtection', 343),
    ]);
    expect(sections.map((s) => [s.title, s.registers.map((r) => r.name)])).toEqual([
      ['Battery and charging', ['TimeFromCVToFloating', 'LowDcProtectionSocGrid', 'SocRecoveryMains', 'OffGridSocProtection']],
      ['Display and sound', ['BeepsWhilePrimarySourceInterrupted']],
      ['Power on/off and energy saving', ['AutoACOutput']],
    ]);
  });

  it('keeps unverified registers out of the normal sections, in their own last section', () => {
    const sections = groupIntoSections([
      ...defs,
      { name: 'Unverified404', label: 'Unverified 404', address: 404, type: 'uint16', group: 'settings', verified: false },
    ]);
    expect(sections.map((s) => s.title).slice(-2)).toEqual(['Device information', 'Unverified registers']);
    expect(sections[sections.length - 1].registers.map((r) => r.name)).toEqual(['Unverified404']);
    expect(sections.find((s) => s.title === 'Device information')!.registers.map((r) => r.name)).toEqual(['RatedPower']);
  });

  it("orders settings like the manual's setting programs, not by address", () => {
    const setting = (name: string, address: number): RegisterDefinition => ({
      name, label: name, address, type: 'uint16', group: 'settings', writable: true,
    });
    const sections = groupIntoSections([
      setting('BatteryDischargeRecoveryMains', 326),
      setting('BatteryLowVoltageProtectionMains', 327),
      setting('MaxChargingCurrent', 332),
      setting('BuzzerMode', 303),
      setting('LcdBacklight', 305),
      setting('LcdAutoReturn', 306),
    ]);
    expect(sections.map((s) => [s.title, s.registers.map((r) => r.name)])).toEqual([
      ['Battery and charging', ['MaxChargingCurrent', 'BatteryLowVoltageProtectionMains', 'BatteryDischargeRecoveryMains']],
      ['Display and sound', ['BuzzerMode', 'LcdAutoReturn', 'LcdBacklight']],
    ]);
  });
});
