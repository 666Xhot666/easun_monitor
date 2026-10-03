import { wordCount, type RegisterMap } from '../registers/register-map';
import type { CaptureRecord } from './capture-summary';
import type { GroundTruthSnapshot } from './ground-truth-store';

/** A reference field an unknown address's value lines up with. */
export interface FieldMatch {
  field: string;
  value: number;
  /** Rate the raw word was multiplied by to match. */
  scale: number;
  exact: boolean;
  /** Significant digits in the reference value: more digits, stronger evidence. */
  digits: number;
  /** Settings and fixed facts are strong evidence; power, current and the like move constantly. */
  stable: boolean;
}

export interface NameSuggestion {
  address: number;
  raw: number;
  /** When `raw` was read (ms since epoch). */
  at: number;
  /** Reference time minus `at`: positive when the reference was taken after the value. */
  gapMs: number;
  matches: FieldMatch[];
  /** For a raw 0: how many reference fields are 0, instead of listing them all. */
  zeroMatches?: number;
}

/** The rates seen across the register map. */
const SCALES = [1, 0.1, 0.01];
const FAST_CHANGING = /(PowerW|PowerVA|CurrentA|VoltageV|FrequencyHz|TemperatureC|Percent)$/;

/**
 * Suggests reference fields (e.g. from the vendor cloud app) for addresses
 * the register map doesn't know: for each unknown address, the value seen
 * closest to the reference time is scaled by each known rate and compared
 * with every numeric field, within the precision the reference shows. These
 * are leads for a person to check, never edits to the register map.
 */
export function suggestNames(
  map: RegisterMap,
  records: readonly CaptureRecord[],
  snapshot: GroundTruthSnapshot,
): NameSuggestion[] {
  const referenceAt = Date.parse(snapshot.capturedAt);
  const definitions = map.list();
  const known = (address: number) =>
    definitions.some((d) => address >= d.address && address < d.address + wordCount(d));

  const closest = new Map<number, { raw: number; at: number }>();
  for (const record of records) {
    if (record.kind !== 'pair') continue;
    record.response.words.forEach((raw, offset) => {
      const address = record.request.address + offset;
      if (known(address)) return;
      const seen = closest.get(address);
      if (!seen || Math.abs(referenceAt - record.responseAt) < Math.abs(referenceAt - seen.at)) {
        closest.set(address, { raw, at: record.responseAt });
      }
    });
  }

  const numeric = Object.entries(snapshot.fields).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );

  return [...closest.entries()]
    .sort(([a], [b]) => a - b)
    .map(([address, { raw, at }]) => {
      const base = { address, raw, at, gapMs: referenceAt - at };
      if (raw === 0) {
        return { ...base, matches: [], zeroMatches: numeric.filter(([, value]) => value === 0).length };
      }
      return { ...base, matches: matchesFor(raw, numeric) };
    });
}

function matchesFor(raw: number, fields: [string, number][]): FieldMatch[] {
  const matches: FieldMatch[] = [];
  for (const [field, value] of fields) {
    if (value === 0) continue;
    const decimals = decimalsOf(value);
    const tolerance = 0.5 * 10 ** -decimals;
    for (const scale of SCALES) {
      const scaled = Number((raw * scale).toFixed(2));
      const difference = Math.abs(scaled - value);
      if (difference > tolerance + 1e-9) continue;
      matches.push({
        field,
        value,
        scale,
        exact: difference < 1e-9,
        digits: significantDigits(value),
        stable: /setting/i.test(field) || !FAST_CHANGING.test(field),
      });
      break;
    }
  }
  return matches.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      Number(b.stable) - Number(a.stable) ||
      b.digits - a.digits ||
      a.field.localeCompare(b.field),
  );
}

/** 27.4 -> 1, 3900 -> 0. */
function decimalsOf(value: number): number {
  const [, fraction = ''] = String(value).split('.');
  return fraction.length;
}

/** 27.4 -> 3, 3900 -> 2, 0.05 -> 1. */
function significantDigits(value: number): number {
  const digits = String(Math.abs(value)).replace('.', '').replace(/^0+/, '');
  return (String(value).includes('.') ? digits : digits.replace(/0+$/, '')).length;
}
