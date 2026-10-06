import { decodeCellInfo } from './jk/cell-info';
import { referenceFrame } from './jk/testing/reference-frames';
import { BmsCsv } from './bms-csv';
import type { BmsReading } from './reading';

const reading: BmsReading = {
  timestamp: '2026-10-05T19:17:34.000Z',
  source: 'mac-ble',
  decoderVersion: 'jk-ble/1',
  ...decodeCellInfo(
    referenceFrame('CELL_INFO_JK02_24S_V10_NEG_TEMPS'),
    'JK02_24S',
  ),
};

describe('BmsCsv', () => {
  const csv = new BmsCsv('Europe/Rome', BmsCsv.layoutFor(reading));

  it('heads the pack values, then one column per cell and temperature sensor', () => {
    expect(csv.header()).toBe(
      [
        'Time (Europe/Rome)',
        'State of charge (%)',
        'Pack voltage (V)',
        'Current (A)',
        'Power (W)',
        'Remaining capacity (Ah)',
        'Nominal capacity (Ah)',
        'Cycles',
        'Lowest cell (V)',
        'Highest cell (V)',
        'Cell spread (mV)',
        'Lowest cell no.',
        'Highest cell no.',
        ...Array.from({ length: 13 }, (_, i) => `Cell ${i + 1} (V)`),
        'T1 (°C)',
        'T2 (°C)',
        'MOS (°C)',
        'Balancing',
        'Balance current (A)',
        'Charge MOSFET',
        'Discharge MOSFET',
        'Alarms',
      ].join(',') + '\r\n',
    );
  });

  it('writes a reading in the chosen time zone with its units implied by the header', () => {
    const cells = csv.row(reading).trimEnd().split(',');

    expect(cells.slice(0, 13)).toEqual([
      '2026-10-05 21:17:34',
      '47',
      '42.786',
      '0.000',
      '0.0',
      String(reading.remainingCapacityAh),
      String(reading.nominalCapacityAh),
      '56',
      '3.288',
      '3.292',
      '4',
      '5',
      '1',
    ]);
    expect(cells[13]).toBe('3.292');
    expect(cells.slice(26, 29)).toEqual([
      '-3.1',
      '-2.9',
      reading.temperaturesC[2].celsius.toFixed(1),
    ]);
    expect(cells.slice(29)).toEqual(['off', '0.000', 'off', 'off', '']);
  });

  it('leaves cells empty for values a reading lacks, and lists alarms', () => {
    const sparse = {
      ...reading,
      currentA: null,
      cellVoltagesV: [3.3],
      temperaturesC: [],
      alarms: ['Cell undervoltage', 'Charge overcurrent'],
    };
    const cells = csv.row(sparse).trimEnd().split(',');

    expect(cells[3]).toBe('');
    expect(cells[13]).toBe('3.300');
    expect(cells[14]).toBe('');
    expect(cells[26]).toBe('');
    expect(cells.at(-1)).toBe('Cell undervoltage; Charge overcurrent');
  });
});
