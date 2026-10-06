import { csvLine, wallClock } from '../telemetry/csv';
import type { BmsReading } from './reading';

/** How many cell columns and which temperature sensors an export has. */
export interface BmsCsvLayout {
  cells: number;
  temperatures: string[];
}

const fixed = (value: number | null | undefined, decimals: number) =>
  typeof value === 'number' ? value.toFixed(decimals) : '';
const plain = (value: number | null | undefined) =>
  typeof value === 'number' ? String(value) : '';
const onOff = (value: boolean | null | undefined) =>
  value === true ? 'on' : value === false ? 'off' : '';

/**
 * Stored BMS readings as CSV: one row per reading, the pack values, a
 * column per cell and per temperature sensor, and time as wall-clock time
 * in `timeZone`.
 */
export class BmsCsv {
  private readonly time: Intl.DateTimeFormat;

  constructor(
    private readonly timeZone: string,
    private readonly layout: BmsCsvLayout,
  ) {
    this.time = wallClock(timeZone);
  }

  /** The columns a reading needs: its cell count and temperature sensors. */
  static layoutFor(reading: BmsReading): BmsCsvLayout {
    return {
      cells: reading.cellVoltagesV.length,
      temperatures: reading.temperaturesC.map((t) => t.name),
    };
  }

  header(): string {
    return csvLine([
      `Time (${this.timeZone})`,
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
      ...Array.from(
        { length: this.layout.cells },
        (_, i) => `Cell ${i + 1} (V)`,
      ),
      ...this.layout.temperatures.map((name) => `${name} (°C)`),
      'Balancing',
      'Balance current (A)',
      'Charge MOSFET',
      'Discharge MOSFET',
      'Alarms',
    ]);
  }

  row(reading: BmsReading): string {
    const celsius = new Map(
      reading.temperaturesC.map((t) => [t.name, t.celsius]),
    );
    return csvLine([
      this.time.format(new Date(reading.timestamp)),
      plain(reading.stateOfChargePct),
      fixed(reading.packVoltageV, 3),
      fixed(reading.currentA, 3),
      fixed(reading.powerW, 1),
      plain(reading.remainingCapacityAh),
      plain(reading.nominalCapacityAh),
      plain(reading.cycleCount),
      fixed(reading.cellMinV, 3),
      fixed(reading.cellMaxV, 3),
      reading.cellDeltaV === null
        ? ''
        : String(Math.round(reading.cellDeltaV * 1000)),
      plain(reading.cellMinIndex),
      plain(reading.cellMaxIndex),
      ...Array.from({ length: this.layout.cells }, (_, i) =>
        fixed(reading.cellVoltagesV[i], 3),
      ),
      ...this.layout.temperatures.map((name) => fixed(celsius.get(name), 1)),
      onOff(reading.balancing),
      fixed(reading.balanceCurrentA, 3),
      onOff(reading.chargeMosfetOn),
      onOff(reading.dischargeMosfetOn),
      reading.alarms.join('; '),
    ]);
  }
}
