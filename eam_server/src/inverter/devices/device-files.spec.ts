import panelFile from './smg-ii/panel-settings.json';
import registerFile from './smg-ii/registers.json';
import rulesFile from './smg-ii/settings-rules.json';
import {
  parsePanelSettingsFile,
  parseRegisterFile,
  parseSettingsRulesFile,
} from './device-files';

const register = (over: object = {}) => ({
  name: 'BatteryVoltage',
  label: 'Battery voltage',
  address: 215,
  type: 'uint16',
  group: 'telemetry',
  ...over,
});
const file = (...registers: object[]) => ({ notes: [], registers });

describe('device files', () => {
  it("reads the SMG-II's registers, panel settings and rules", () => {
    const registers = parseRegisterFile(registerFile, 'smg-ii/registers.json');
    expect(registers).toHaveLength(125);
    expect(registers.find((r) => r.name === 'OutputPriority')).toMatchObject({
      address: 301,
      writable: true,
      options: expect.arrayContaining(['Solar-utility-battery (SUB)']),
    });
    expect(
      parsePanelSettingsFile(panelFile, 'smg-ii/panel-settings.json'),
    ).toHaveLength(8);
    const rules = parseSettingsRulesFile(
      rulesFile,
      registers,
      'smg-ii/settings-rules.json',
    );
    expect(rules.voltageRanges[24].MaxChargingVoltage).toEqual({
      min: 24,
      max: 30,
    });
    expect(
      rules.rules.length +
        rules.inactiveRules.length +
        rules.lithiumRules.length,
    ).toBe(13);
  });

  it('refuses a register it cannot use, naming the file and the register', () => {
    const wrong: Array<[object, RegExp]> = [
      [register({ type: 'float' }), /registers\[0\] \(BatteryVoltage\)\.type/],
      [register({ group: 'misc' }), /\.group/],
      [register({ address: -1 }), /\.address/],
      [register({ label: '' }), /\.label/],
      [register({ scale: 'x' }), /\.scale/],
      [register({ options: ['On', 2] }), /\.options/],
      [register({ type: 'ascii' }), /\.length/],
      [register({ bits: { x: 'Fault' } }), /\.bits/],
    ];
    for (const [r, message] of wrong) {
      expect(() => parseRegisterFile(file(r), 'test.json')).toThrow(message);
    }
    expect(() => parseRegisterFile({ registers: 'none' }, 'test.json')).toThrow(
      /test\.json: registers/,
    );
  });

  it('refuses two registers with one name or overlapping addresses', () => {
    expect(() =>
      parseRegisterFile(
        file(register(), register({ address: 216 })),
        'test.json',
      ),
    ).toThrow(/BatteryVoltage.*twice/);
    expect(() =>
      parseRegisterFile(
        file(
          register({ name: 'Code', type: 'uint32', address: 100 }),
          register({ name: 'Other', address: 101 }),
        ),
        'test.json',
      ),
    ).toThrow(/Other.*101.*Code/);
  });

  it('refuses rules about settings the map does not have', () => {
    const registers = parseRegisterFile(registerFile, 'smg-ii/registers.json');
    const broken = {
      ...rulesFile,
      rules: [
        ...rulesFile.rules,
        {
          id: 'R-X',
          kind: 'compare',
          severity: 'error',
          left: 'NoSuchSetting',
          op: '>',
          right: 'MaxChargingVoltage',
          key: 'x',
          message: 'x',
        },
      ],
    };
    expect(() =>
      parseSettingsRulesFile(broken, registers, 'rules.json'),
    ).toThrow(/rules\.json: rules\[\d+\] \(R-X\): NoSuchSetting/);
    expect(() =>
      parseSettingsRulesFile(
        { ...rulesFile, rules: [{ id: 'R-Y', key: 'y', kind: 'guess' }] },
        registers,
        'rules.json',
      ),
    ).toThrow(/R-Y.*kind/);
  });
});
