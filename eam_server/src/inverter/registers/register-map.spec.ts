import { RegisterMap, RegisterValueError, type RegisterDefinition } from './register-map';
import { SMG_II_REGISTERS } from './smg-ii.registers';

const defs: RegisterDefinition[] = [
  { name: 'Mode', label: 'Mode', address: 201, type: 'uint16', group: 'telemetry', options: ['Standby', 'Mains', 'OffGrid'] },
  { name: 'MainsVoltage', label: 'Mains voltage', address: 202, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'BatteryCurrent', label: 'Battery current', address: 204, type: 'int16', scale: 0.1, unit: 'A', group: 'telemetry' },
  { name: 'FaultCode', label: 'Fault code', address: 100, type: 'uint32', group: 'status', bits: { 1: 'Inverter over temperature', 3: 'Battery over voltage' } },
  { name: 'OutputVoltageSet', label: 'Output voltage', address: 320, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true, min: 200, max: 240 },
  { name: 'Priority', label: 'Priority', address: 301, type: 'uint16', group: 'settings', writable: true, options: ['UTI', 'SOL', 'SBU'] },
  { name: 'EqTime', label: 'Eq time', address: 335, type: 'uint16', unit: 'min', group: 'settings', writable: true, min: 0, max: 900 },
  { name: 'RatedPower', label: 'Rated power', address: 643, type: 'uint16', unit: 'W', group: 'settings' },
];
const map = new RegisterMap(defs);

describe('RegisterMap lookup', () => {
  it('finds registers by name and lists them by group', () => {
    expect(map.get('MainsVoltage')?.address).toBe(202);
    expect(map.get('Nope')).toBeUndefined();
    expect(map.list('telemetry').map((d) => d.name)).toEqual(['Mode', 'MainsVoltage', 'BatteryCurrent']);
  });

  it('rejects duplicate names or overlapping addresses', () => {
    expect(() => new RegisterMap([defs[1], { ...defs[1], address: 999 }])).toThrow(/duplicate/i);
    expect(() => new RegisterMap([defs[3], { ...defs[1], address: 101 }])).toThrow(/overlap/i);
  });
});

describe('RegisterMap blocks', () => {
  it('merges nearby registers of a group into one read, bridging small gaps', () => {
    expect(map.blocks('telemetry')).toEqual([{ address: 201, count: 4 }]);
  });

  it('splits registers that are far apart', () => {
    expect(map.blocks('settings')).toEqual([
      { address: 301, count: 1 },
      { address: 320, count: 1 },
      { address: 335, count: 1 },
      { address: 643, count: 1 },
    ]);
  });

  it('covers both words of a 32-bit register', () => {
    expect(map.blocks('status')).toEqual([{ address: 100, count: 2 }]);
  });
});

describe('RegisterMap decode', () => {
  it('turns block words into a reading keyed by register name', () => {
    // 201 Mode=1, 202 230.5 V, 203 gap, 204 -12.3 A (two's complement)
    const words = [1, 2305, 0, 0x10000 - 123];
    expect(map.decodeBlock({ address: 201, count: 4 }, words)).toEqual({
      Mode: 1,
      MainsVoltage: 230.5,
      BatteryCurrent: -12.3,
    });
  });

  it('decodes a 32-bit register high word first', () => {
    expect(map.decodeBlock({ address: 100, count: 2 }, [0x0001, 0x0002])).toEqual({
      FaultCode: 0x00010002,
    });
  });

  it('rounds away binary noise from scaling', () => {
    expect(map.decodeBlock({ address: 320, count: 1 }, [2201])).toEqual({ OutputVoltageSet: 220.1 });
  });
});

describe('RegisterMap encode', () => {
  it('scales a value back to its raw register word', () => {
    expect(map.encode('OutputVoltageSet', 220.1)).toEqual({ address: 320, values: [2201] });
    expect(map.encode('Priority', 2)).toEqual({ address: 301, values: [2] });
  });

  it('rejects registers that are not writable or unknown', () => {
    expect(() => map.encode('RatedPower', 3200)).toThrow(RegisterValueError);
    expect(() => map.encode('MainsVoltage', 230)).toThrow(/not writable/);
    expect(() => map.encode('Nope', 1)).toThrow(/Unknown register/);
  });

  it('rejects values outside the documented range', () => {
    expect(() => map.encode('OutputVoltageSet', 250)).toThrow(/between 200 and 240/);
    expect(() => map.encode('EqTime', 901)).toThrow(/between 0 and 900/);
  });

  it('rejects enum values without an option', () => {
    expect(() => map.encode('Priority', 3)).toThrow(/not a valid option/);
    expect(() => map.encode('Priority', 1.5)).toThrow(/not a valid option/);
  });

  it('rejects values finer than the register resolution', () => {
    expect(() => map.encode('OutputVoltageSet', 220.15)).toThrow(/resolution/);
  });
});

describe('RegisterMap text registers', () => {
  const text = new RegisterMap([
    { name: 'SerialNumber', label: 'Serial number', address: 186, type: 'ascii', length: 4, group: 'info' },
    { name: 'Mode', label: 'Mode', address: 201, type: 'uint16', group: 'telemetry' },
  ]);
  // "92 33 24 05" packed two characters per word, then NUL padding.
  const words = [0x3932, 0x3333, 0x3234, 0x0000];

  it('spans its full length and is read as one block', () => {
    expect(text.blocks('info')).toEqual([{ address: 186, count: 4 }]);
  });

  it('decodes as text, two characters per word, without trailing padding', () => {
    expect(text.decodeText({ address: 186, count: 4 }, words)).toEqual({ SerialNumber: '923324' });
  });

  it('stays out of numeric readings', () => {
    expect(text.decodeBlock({ address: 186, count: 4 }, words)).toEqual({});
  });
});

describe('RegisterMap flags', () => {
  it('lists the labels of the bits set in a bitfield register', () => {
    expect(map.activeFlags('FaultCode', 0b1010)).toEqual(['Inverter over temperature', 'Battery over voltage']);
    expect(map.activeFlags('FaultCode', 0)).toEqual([]);
  });

  it('names bits it has no label for instead of hiding them', () => {
    expect(map.activeFlags('FaultCode', 1 << 20)).toEqual(['Code 20']);
  });

  it('handles all 32 bits', () => {
    expect(map.activeFlags('FaultCode', 0x80000000)).toEqual(['Code 31']);
  });
});

describe('SMG-II register table', () => {
  const smg = new RegisterMap(SMG_II_REGISTERS);

  it('is a valid map with the documented telemetry and settings', () => {
    expect(smg.get('MainsVoltage')).toMatchObject({ address: 202, scale: 0.1, unit: 'V' });
    expect(smg.get('BatterySoc')).toMatchObject({ address: 229, unit: '%' });
    expect(smg.get('OutputVoltageSet')).toMatchObject({ address: 320, writable: true });
    expect(smg.get('OutputPriority')?.options).toEqual([
      'Utility first (UTI)', 'Solar first (SOL)', 'Solar-battery-utility (SBU)', 'Solar-utility-battery (SUB)',
    ]);
    expect(smg.encode('OutputPriority', 3)).toEqual({ address: 301, values: [3] });
    expect(smg.get('RatedPower')?.writable).toBeFalsy();
  });

  it('describes every documented fault and warning bit', () => {
    expect(smg.activeFlags('FaultCode', 1 << 7)).toEqual(['Output overload']);
    expect(smg.activeFlags('WarningCode', (1 << 8) | (1 << 14))).toEqual([
      'Battery low voltage',
      'Fan blocked',
    ]);
  });

  it('explains every setting the way the manual does', () => {
    for (const definition of smg.list('settings')) {
      expect({ name: definition.name, description: definition.description }).toEqual({
        name: definition.name,
        description: expect.stringMatching(/\w{3,}/),
      });
      if (definition.optionDescriptions) {
        expect(definition.optionDescriptions).toHaveLength(definition.options!.length);
      }
    }
    expect(smg.get('OutputPriority')).toMatchObject({ panelProgram: '01', default: 0 });
    expect(smg.get('OutputPriority')?.optionDescriptions?.[2]).toMatch(/program 12/);
    expect(smg.get('BatteryEqualizationTime')).toMatchObject({ panelProgram: '35', default: 60 });
    expect(smg.get('MaxChargingVoltage')?.defaultByBatteryVoltage).toEqual({ 12: 14.1, 24: 28.2, 48: 56.4 });
    expect(smg.get('EnergySavingMode')?.panelProgram).toBeUndefined();
  });

  it("names settings and options in the manual's words", () => {
    expect(smg.get('InputVoltageRange')).toMatchObject({
      label: 'AC input voltage range',
      options: ['Appliances (90-280 V)', 'UPS (170-280 V)', 'Generator (90-280 V)'],
    });
    expect(smg.get('BuzzerMode')?.options).toEqual([
      'Beeps OFF', 'Beeps ON', 'Mute when input source changes', 'Beeps only in fault mode',
    ]);
    expect(smg.get('BuzzerMode')?.optionDescriptions?.[2]).toMatch(/Mode 3/);
    expect(smg.get('LcdBacklight')?.options).toEqual(['Backlight off (timed)', 'Backlight on']);
    expect(smg.get('LcdAutoReturn')?.options).toEqual(['Stay at latest screen', 'Return to default screen']);
    expect(smg.get('BatteryChargingPriority')?.options?.[0]).toBe('Utility first (not on the panel)');
    expect(smg.get('BatteryLowVoltageProtectionMains')?.label).toBe('Back to utility voltage');
    expect(smg.get('BatteryDischargeRecoveryMains')?.label).toBe('Back to battery voltage');
    expect(smg.get('BatteryLowVoltageProtectionOffGrid')?.label).toBe('Low DC cut-off voltage');
    expect(smg.get('MaxChargingVoltage')?.label).toBe('Bulk charging voltage');
  });

  it('states the consequence of changing a risky setting', () => {
    const risky = smg.list('settings').filter((d) => d.risk).map((d) => d.name);
    expect(risky).toEqual(['OutputMode', 'BatteryOvervoltageProtection', 'TurnOnMode', 'RemoteSwitch', 'OutputControl']);
    expect(smg.get('OutputControl')).toMatchObject({ address: 460, writable: true, options: ['Off', 'On'] });
    expect(smg.get('OutputControl')?.risk).toMatch(/AC output/);
    expect(smg.get('RemoteSwitch')?.risk).toMatch(/AC output/);
    expect(smg.get('OutputMode')?.options?.slice(5)).toEqual(['2-phase P1', '2-phase P2']);
    expect(smg.get('OutputMode')?.risk).toMatch(/selectable but undocumented/);
  });

  it('includes the settings found on the device beyond the protocol document', () => {
    expect(smg.get('BeepsWhilePrimarySourceInterrupted')).toMatchObject({ address: 304, writable: true, options: ['Beeps OFF', 'Beeps ON'] });
    expect(smg.get('TimeFromCVToFloating')).toMatchObject({ address: 330, writable: true, unit: 'min' });
    expect(smg.get('BatteryType')).toMatchObject({
      address: 322, panelProgram: '05', options: ['AGM', 'Flooded', 'User-Defined', 'Lithium without communication'],
    });
    expect(smg.get('BatteryType')?.writable).toBeFalsy();
    expect(smg.get('AutoACOutput')).toMatchObject({
      address: 338, writable: true, options: ['Disable with power switch OFF', 'Enable with power switch ON'],
    });
    for (const [name, address] of [['LowDcProtectionSocGrid', 341], ['SocRecoveryMains', 342], ['OffGridSocProtection', 343]] as const) {
      expect(smg.get(name)).toMatchObject({ address, writable: true, unit: '%', min: 0, max: 100 });
    }
    expect(() => smg.encode('SocRecoveryMains', 101)).toThrow(/between 0 and 100/);
  });

  it('accepts only the output voltages and frequencies the panel offers', () => {
    expect(smg.encode('OutputVoltageSet', 240)).toEqual({ address: 320, values: [2400] });
    expect(() => smg.encode('OutputVoltageSet', 231)).toThrow(/220, 230 or 240 V/);
    expect(smg.encode('OutputFrequencySet', 60)).toEqual({ address: 321, values: [6000] });
    expect(() => smg.encode('OutputFrequencySet', 55)).toThrow(/50 or 60 Hz/);
  });

  it('reads all telemetry in one request', () => {
    expect(smg.blocks('telemetry')).toHaveLength(1);
  });
});
