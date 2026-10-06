import type {
  RegisterDefinition,
  RegisterMap,
} from '../inverter/registers/register-map';
import type { ReadingPayload } from './telemetry.store';

const LINE_END = '\r\n';

/** Quotes a cell when it holds a comma, quote or line break. */
const cell = (text: string): string =>
  /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

const line = (cells: string[]): string => cells.map(cell).join(',') + LINE_END;

/** Decimals that match a register's resolution: 0.1 -> 1, 0.01 -> 2. */
const decimalsFor = (definition: RegisterDefinition): number => {
  const scale = definition.scale ?? 1;
  return scale >= 1 ? 0 : Math.ceil(-Math.log10(scale));
};

/**
 * Readings as CSV: one row per reading, a column per telemetry and status
 * register (in address order), values named and formatted like the
 * dashboard (enum options by name, active fault and warning bits by
 * description), and time as wall-clock time in `timeZone`.
 */
export class ReadingsCsv {
  private readonly columns: RegisterDefinition[];
  // sv-SE formats as "2026-10-05 21:17:34".
  private readonly time: Intl.DateTimeFormat;

  constructor(
    private readonly map: RegisterMap,
    private readonly timeZone: string,
  ) {
    this.columns = map
      .list()
      .filter((d) => d.group === 'telemetry' || d.group === 'status');
    this.time = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  }

  header(): string {
    return line([
      `Time (${this.timeZone})`,
      ...this.columns.map((d) => (d.unit ? `${d.label} (${d.unit})` : d.label)),
    ]);
  }

  row(reading: { timestamp: Date; payload: ReadingPayload }): string {
    return line([
      this.time.format(reading.timestamp),
      ...this.columns.map((d) => this.format(d, reading.payload[d.name])),
    ]);
  }

  private format(
    definition: RegisterDefinition,
    value: number | undefined,
  ): string {
    if (typeof value !== 'number' || Number.isNaN(value)) return '';
    if (definition.bits)
      return this.map.activeFlags(definition.name, value).join('; ');
    if (definition.options)
      return definition.options[value] ?? `Unknown (${value})`;
    return value.toFixed(decimalsFor(definition));
  }
}
