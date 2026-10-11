import type { Language } from '../i18n/languages';
import { translate } from '../i18n/translate';
import type {
  RegisterDefinition,
  RegisterMap,
} from '../inverter/registers/register-map';
import { csvLine, wallClock } from './csv';
import type { ReadingPayload } from './telemetry.store';

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
  private readonly time: Intl.DateTimeFormat;

  /** `map` gives the column and option names, in `language`. */
  constructor(
    private readonly map: RegisterMap,
    private readonly timeZone: string,
    private readonly language: Language = 'en',
  ) {
    this.columns = map
      .list()
      .filter((d) => d.group === 'telemetry' || d.group === 'status');
    this.time = wallClock(timeZone);
  }

  header(): string {
    const t = (key: string, values?: Record<string, string>) =>
      translate(this.language, `csv.${key}`, values);
    return csvLine([
      t('time', { zone: this.timeZone }),
      ...this.columns.map((d) =>
        d.unit ? `${d.label} (${t(`units.${d.unit}`)})` : d.label,
      ),
    ]);
  }

  row(reading: { timestamp: Date; payload: ReadingPayload }): string {
    return csvLine([
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
      return (
        definition.options[value] ??
        translate(this.language, 'csv.unknown', { value: String(value) })
      );
    return value.toFixed(decimalsFor(definition));
  }
}
