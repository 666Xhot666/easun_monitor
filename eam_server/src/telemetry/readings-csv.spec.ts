import {
  RegisterMap,
  type RegisterDefinition,
} from '../inverter/registers/register-map';
import { ReadingsCsv } from './readings-csv';

const definitions: RegisterDefinition[] = [
  {
    name: 'FaultCode',
    label: 'Faults',
    address: 100,
    type: 'uint32',
    group: 'status',
    bits: { 1: 'Over temperature', 3: 'Battery over voltage' },
  },
  {
    name: 'OperationMode',
    label: 'Operating mode',
    address: 201,
    type: 'uint16',
    group: 'telemetry',
    options: ['Power on', 'Standby', 'Mains'],
  },
  {
    name: 'MainsVoltage',
    label: 'Mains voltage',
    address: 202,
    type: 'int16',
    scale: 0.1,
    unit: 'V',
    group: 'telemetry',
  },
  {
    name: 'PVPower',
    label: 'PV power',
    address: 223,
    type: 'int16',
    unit: 'W',
    group: 'telemetry',
  },
  {
    name: 'Odd',
    label: 'Odd, "quoted" name',
    address: 250,
    type: 'uint16',
    group: 'telemetry',
  },
  {
    name: 'OutputPriority',
    label: 'Output priority',
    address: 301,
    type: 'uint16',
    group: 'settings',
    options: ['UTI', 'SOL', 'SBU'],
  },
];
const csv = new ReadingsCsv(new RegisterMap(definitions), 'Europe/Rome');

describe('ReadingsCsv', () => {
  it('heads a column per telemetry and status register, with units, after the local time', () => {
    expect(csv.header()).toBe(
      'Time (Europe/Rome),Faults,Operating mode,Mains voltage (V),PV power (W),"Odd, ""quoted"" name"\r\n',
    );
  });

  it('writes one reading as named, formatted values in the chosen time zone', () => {
    const row = csv.row({
      timestamp: new Date('2026-10-05T19:17:34.900Z'),
      payload: {
        FaultCode: 0b1010,
        OperationMode: 2,
        MainsVoltage: 231.40000000000003,
        PVPower: 0,
        Odd: 7,
      },
    });

    expect(row).toBe(
      '2026-10-05 21:17:34,Over temperature; Battery over voltage,Mains,231.4,0,7\r\n',
    );
  });

  it('leaves a cell empty when the reading lacks that register', () => {
    expect(
      csv.row({
        timestamp: new Date('2026-10-05T19:17:34Z'),
        payload: { PVPower: 278 },
      }),
    ).toBe('2026-10-05 21:17:34,,,,278,\r\n');
  });

  it('shows an enum value it has no name for as its number', () => {
    expect(
      csv.row({
        timestamp: new Date('2026-10-05T19:17:34Z'),
        payload: { OperationMode: 9, FaultCode: 0 },
      }),
    ).toBe('2026-10-05 21:17:34,,Unknown (9),,,\r\n');
  });
});
