/**
 * A device's common readings: how its registers give the readings in
 * common-readings.ts. Read from devices/<model>/readings.json and checked
 * against the device's Register map when loaded.
 *
 * Type-erasable TypeScript only, like the Register map.
 */
import type { RegisterDefinition } from '../registers/register-map.ts';
import {
  COMMON_READINGS,
  INVERTER_STATES,
  type CommonReading,
  type CommonSnapshot,
  type InverterState,
} from './common-readings.ts';

/** Where a common reading comes from: one register, or the product of several. */
export type ReadingSource = { register: string } | { product: string[] };

export interface ReadingsFile {
  readings: Partial<Record<CommonReading, ReadingSource>>;
  /** The register whose raw value, by position in `values`, is the state. */
  state?: { from: string; values: (InverterState | null)[] };
}

function fail(file: string, path: string, what: string): never {
  throw new Error(`${file}: ${path}: ${what}`);
}

/** The mapping in `json`, every register it names checked against `registers`. */
export function parseReadingsFile(
  json: unknown,
  registers: readonly RegisterDefinition[],
  file: string,
): ReadingsFile {
  const known = new Set(registers.map((r) => r.name));
  const register = (v: unknown, path: string): string => {
    if (typeof v !== 'string') fail(file, path, 'expected a register name');
    if (!known.has(v)) fail(file, path, `${v} is not in the register map`);
    return v;
  };
  const o = json as { readings?: unknown; state?: unknown };
  if (typeof o?.readings !== 'object' || o.readings === null)
    fail(file, 'readings', 'expected an object');
  const readings: ReadingsFile['readings'] = {};
  for (const [name, source] of Object.entries(o.readings)) {
    const path = `readings.${name}`;
    if (!(COMMON_READINGS as readonly string[]).includes(name))
      fail(file, path, 'not a common reading');
    const s = source as { product?: unknown };
    readings[name as CommonReading] =
      typeof source === 'string'
        ? { register: register(source, path) }
        : Array.isArray(s?.product) && s.product.length >= 2
          ? {
              product: s.product.map((r, i) =>
                register(r, `${path}.product[${i}]`),
              ),
            }
          : fail(
              file,
              path,
              'expected a register name or { "product": [...] }',
            );
  }
  if (o.state === undefined) return { readings };
  const state = o.state as { from?: unknown; values?: unknown };
  if (!Array.isArray(state.values))
    fail(file, 'state.values', 'expected a list');
  return {
    readings,
    state: {
      from: register(state.from, 'state.from'),
      values: state.values.map((v, i) => {
        if (v === null) return null;
        if (!(INVERTER_STATES as readonly unknown[]).includes(v))
          fail(
            file,
            `state.values[${i}]`,
            `${String(v)} is not an inverter state`,
          );
        return v as InverterState;
      }),
    },
  };
}

/** Rounded to 0.01, so a product of scaled values reads as it would on a meter. */
const hundredths = (v: number) => Math.round(v * 100) / 100;

/** One device's common readings, from its raw register values. */
export class DeviceReadings {
  private readonly file: ReadingsFile;

  constructor(file: ReadingsFile) {
    this.file = file;
  }

  /** `payload` (register name -> value) in common terms. */
  common(payload: Readonly<Record<string, number>>): CommonSnapshot {
    const out: CommonSnapshot = {};
    for (const name of COMMON_READINGS) {
      const source = this.file.readings[name];
      if (!source) continue;
      if ('register' in source) {
        const value = payload[source.register];
        if (typeof value === 'number') out[name] = value;
        continue;
      }
      const values = source.product.map((r) => payload[r]);
      if (values.every((v) => typeof v === 'number'))
        out[name] = hundredths(values.reduce((a, b) => a * b, 1));
    }
    const state = this.file.state;
    if (state) {
      const raw = payload[state.from];
      const value = typeof raw === 'number' ? state.values[raw] : undefined;
      if (value) out.state = value;
    }
    return out;
  }

  /** The registers behind `name`, or null when this device does not give it. */
  source(name: CommonReading): ReadingSource | null {
    return this.file.readings[name] ?? null;
  }
}
