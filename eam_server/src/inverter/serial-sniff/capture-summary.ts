import { wordCount, type RegisterDefinition, type RegisterMap } from '../registers/register-map';
import type { Bounds } from '../settings-rules/settings-rules';
import type { PairResult } from './request-response-pairer';

/**
 * plausible: a known register with a value inside its options/choices/range
 * (or with nothing to check against); implausible: a known register with a
 * value outside them; unverified: mapped but not yet identified; unknown: an
 * address the register map doesn't have.
 */
export type ObservationCategory = 'plausible' | 'implausible' | 'unverified' | 'unknown';

export interface Observation {
  address: number;
  name: string | null;
  /** Real (scaled) value for a known register; the raw word otherwise. */
  value: number;
  category: ObservationCategory;
  reason?: string;
}

/** One line of a capture file. */
export type CaptureRecord =
  | (PairResult & { seq: number })
  | { seq: number; kind: 'port'; at: number; port: 'rx' | 'tx'; state: string; message?: string };

export interface AddressSummary {
  address: number;
  name: string | null;
  latestValue: number;
  /** The worst category ever seen, so one implausible value stays visible. */
  category: ObservationCategory;
  reason?: string;
  seen: number;
  lastSeenAt: number;
}

export interface CaptureSummary {
  counts: {
    pairs: number;
    plausible: number;
    implausible: number;
    unverified: number;
    unknown: number;
    unanswered: number;
    orphan: number;
    reconnects: number;
  };
  /** Unique addresses seen in paired reads, by address. */
  addresses: AddressSummary[];
  /** Requests that never got a fitting response, by address and size. */
  unanswered: { address: number; quantity: number; count: number }[];
}

type Read = Pick<Extract<PairResult, { kind: 'pair' }>, 'request' | 'response'>;

/** What each register in one paired read held, checked against the map. */
export function observePair(map: RegisterMap, pair: Read, bounds: Record<string, Bounds> = {}): Observation[] {
  const { address, quantity } = pair.request;
  const reading = map.decodeBlock({ address, count: quantity }, pair.response.words);
  const definitions = map.list();
  const observations: Observation[] = [];

  for (let offset = 0; offset < quantity; offset++) {
    const at = address + offset;
    const definition = definitions.find((d) => at >= d.address && at < d.address + wordCount(d));
    if (!definition) {
      observations.push({ address: at, name: null, value: pair.response.words[offset], category: 'unknown' });
      continue;
    }
    // Report a register once, at its own address; skip the second word of
    // a 32-bit register and registers only partly inside this read.
    if (at !== definition.address || !(definition.name in reading)) continue;
    const value = reading[definition.name];
    if (definition.verified === false) {
      observations.push({ address: at, name: definition.name, value, category: 'unverified' });
      continue;
    }
    const reason = implausibility(definition, value, bounds[definition.name]);
    observations.push({
      address: at,
      name: definition.name,
      value,
      category: reason ? 'implausible' : 'plausible',
      ...(reason ? { reason } : {}),
    });
  }
  return observations;
}

function implausibility(definition: RegisterDefinition, value: number, bounds?: Bounds): string | undefined {
  if (definition.options) {
    return Number.isInteger(value) && value >= 0 && value < definition.options.length
      ? undefined
      : `not one of its ${definition.options.length} options`;
  }
  if (definition.choices && !definition.choices.includes(value)) {
    return `not one of ${definition.choices.join(', ')}`;
  }
  for (const range of [{ min: definition.min, max: definition.max }, bounds]) {
    if (!range) continue;
    if ((range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max)) {
      const context = 'context' in range && range.context ? ` ${range.context}` : '';
      return `outside ${range.min ?? '-∞'}-${range.max ?? '∞'}${context}`;
    }
  }
  return undefined;
}

const SEVERITY: Record<ObservationCategory, number> = { plausible: 0, unverified: 1, unknown: 2, implausible: 3 };

/** Per-address findings and counts for a whole capture. */
export function summarizeCapture(
  map: RegisterMap,
  records: readonly CaptureRecord[],
  bounds: Record<string, Bounds> = {},
): CaptureSummary {
  const byAddress = new Map<number, AddressSummary>();
  const unanswered = new Map<string, { address: number; quantity: number; count: number }>();
  const counts = { pairs: 0, plausible: 0, implausible: 0, unverified: 0, unknown: 0, unanswered: 0, orphan: 0, reconnects: 0 };

  for (const record of records) {
    if (record.kind === 'pair') {
      counts.pairs++;
      for (const observation of observePair(map, record, bounds)) {
        const existing = byAddress.get(observation.address);
        const worse = !existing || SEVERITY[observation.category] > SEVERITY[existing.category];
        byAddress.set(observation.address, {
          address: observation.address,
          name: observation.name,
          latestValue: observation.value,
          category: worse ? observation.category : existing.category,
          ...(worse ? (observation.reason ? { reason: observation.reason } : {}) : existing.reason ? { reason: existing.reason } : {}),
          seen: (existing?.seen ?? 0) + 1,
          lastSeenAt: record.responseAt,
        });
      }
    } else if (record.kind === 'unanswered') {
      counts.unanswered++;
      const key = `${record.request.address}x${record.request.quantity}`;
      const entry = unanswered.get(key) ?? { address: record.request.address, quantity: record.request.quantity, count: 0 };
      entry.count++;
      unanswered.set(key, entry);
    } else if (record.kind === 'orphan') {
      counts.orphan++;
    } else if (record.state === 'reconnecting') {
      counts.reconnects++;
    }
  }

  const addresses = [...byAddress.values()].sort((a, b) => a.address - b.address);
  for (const { category } of addresses) counts[category]++;
  return {
    counts,
    addresses,
    unanswered: [...unanswered.values()].sort((a, b) => a.address - b.address),
  };
}
