import readingsFile from '../devices/smg-ii/readings.json';
import { SMG_II_REGISTERS } from '../registers/smg-ii.registers';
import { DeviceReadings, parseReadingsFile } from './device-readings';

const smgII = () =>
  new DeviceReadings(
    parseReadingsFile(readingsFile, SMG_II_REGISTERS, 'smg-ii/readings.json'),
  );

describe('DeviceReadings', () => {
  it('gives an SMG-II snapshot in common terms', () => {
    expect(
      smgII().common({
        PVPower: 410,
        PVVoltage: 86.6,
        BatteryVoltage: 26.1,
        BatteryCurrentSigned: -12.6,
        BatterySoc: 88,
        MainsVoltage: 219.3,
        AverageMainsPower: 0,
        OutputActivePower: 494,
        OperationMode: 3,
        InverterTemperature: 20,
      }),
    ).toEqual({
      pvPower: 410,
      pvVoltage: 86.6,
      batteryVoltage: 26.1,
      batteryCurrent: -12.6,
      batteryPower: -328.86,
      batterySoc: 88,
      gridVoltage: 219.3,
      gridPower: 0,
      loadPower: 494,
      state: 'off-grid',
    });
  });

  it('leaves out what the snapshot does not have, and a state it cannot name', () => {
    expect(smgII().common({ PVPower: 5, BatteryVoltage: 27 })).toEqual({
      pvPower: 5,
      batteryVoltage: 27,
    });
    expect(smgII().common({ OperationMode: 9 })).toEqual({});
  });

  it('names the register behind a common reading, for queries over stored readings', () => {
    const readings = smgII();
    expect(readings.source('pvPower')).toEqual({ register: 'PVPower' });
    expect(readings.source('batteryPower')).toEqual({
      product: ['BatteryVoltage', 'BatteryCurrentSigned'],
    });
  });

  it('refuses a mapping to a register the map does not have, or an unknown reading', () => {
    const wrong = (over: object) =>
      parseReadingsFile(
        { ...readingsFile, ...over },
        SMG_II_REGISTERS,
        'readings.json',
      );
    expect(() => wrong({ readings: { pvPower: 'NoSuchRegister' } })).toThrow(
      /readings\.json: readings\.pvPower: NoSuchRegister/,
    );
    expect(() => wrong({ readings: { sunshine: 'PVPower' } })).toThrow(
      /readings\.sunshine: not a common reading/,
    );
    expect(() =>
      wrong({ state: { from: 'OperationMode', values: ['grid', 'asleep'] } }),
    ).toThrow(/state\.values\[1\]: asleep is not an inverter state/);
  });
});
