import { csvLine, wallClock } from '../telemetry/csv';
import type { Language } from '../i18n/languages';
import { translate } from '../i18n/translate';
import { bmsAlarmName } from '../telegram/cards';
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
    private readonly language: Language = 'en',
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
    const t = (key: string, values?: Record<string, string | number>) =>
      translate(this.language, `csv.${key}`, values);
    return csvLine([
      t('time', { zone: this.timeZone }),
      ...[
        'soc',
        'packVoltage',
        'current',
        'power',
        'remaining',
        'nominal',
        'cycles',
        'lowestCell',
        'highestCell',
        'spread',
        'lowestNo',
        'highestNo',
      ].map((key) => t(`bms.${key}`)),
      ...Array.from({ length: this.layout.cells }, (_, i) =>
        t('bms.cell', { n: i + 1 }),
      ),
      ...this.layout.temperatures.map((name) => `${name} (°C)`),
      ...[
        'balancing',
        'balanceCurrent',
        'chargeMosfet',
        'dischargeMosfet',
        'alarms',
      ].map((key) => t(`bms.${key}`)),
    ]);
  }

  private onOff(value: boolean | null | undefined): string {
    if (value === null || value === undefined) return '';
    return translate(this.language, value ? 'csv.on' : 'csv.off');
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
      this.onOff(reading.balancing),
      fixed(reading.balanceCurrentA, 3),
      this.onOff(reading.chargeMosfetOn),
      this.onOff(reading.dischargeMosfetOn),
      reading.alarms.map((a) => bmsAlarmName(a, this.language)).join('; '),
    ]);
  }
}
