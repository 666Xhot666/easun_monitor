import { MIN_CURRENT_SPAN_A, PAIR_CURRENT_TOLERANCE } from './constants';

/**
 * A BMS reading and an inverter reading taken at about the same moment.
 * Currents are signed, positive while charging.
 */
export interface VoltagePair {
  bmsVoltageV: number;
  bmsCurrentA: number;
  inverterVoltageV: number;
  inverterCurrentA: number;
}

/**
 * How the inverter's battery voltage relates to the battery's own (the
 * BMS's): inverter = battery + offsetV + resistanceOhm × current. The
 * resistance is the whole path between the BMS and the point the inverter
 * measures at (cables, lugs, fuse or breaker); the offset is the inverter's
 * calibration.
 */
export interface WiringFit {
  resistanceOhm: number;
  offsetV: number;
  samples: number;
  /** Lowest and highest current among the pairs used. */
  minCurrentA: number;
  maxCurrentA: number;
}

/** True when both currents say the same: same direction, and close in size. */
function sameMoment(p: VoltagePair): boolean {
  if (Math.sign(p.bmsCurrentA) !== Math.sign(p.inverterCurrentA)) return false;
  const tolerance = Math.max(
    PAIR_CURRENT_TOLERANCE.amperes,
    PAIR_CURRENT_TOLERANCE.fraction * Math.abs(p.bmsCurrentA),
  );
  return Math.abs(p.bmsCurrentA - p.inverterCurrentA) <= tolerance;
}

/**
 * Least-squares fit of (inverter − battery voltage) against the BMS
 * current, over the pairs whose currents agree. Null until their currents
 * span MIN_CURRENT_SPAN_A, since without that the offset and the
 * resistance cannot be told apart.
 */
export function fitWiringDrop(pairs: VoltagePair[]): WiringFit | null {
  const used = pairs.filter(sameMoment);
  if (used.length < 2) return null;
  const xs = used.map((p) => p.bmsCurrentA);
  const ys = used.map((p) => p.inverterVoltageV - p.bmsVoltageV);
  const minCurrentA = Math.min(...xs);
  const maxCurrentA = Math.max(...xs);
  if (maxCurrentA - minCurrentA < MIN_CURRENT_SPAN_A) return null;

  const n = used.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  const resistanceOhm = sxy / sxx;
  return {
    resistanceOhm,
    offsetV: meanY - resistanceOhm * meanX,
    samples: n,
    minCurrentA,
    maxCurrentA,
  };
}

/** What the inverter reads when the battery is at batteryV with currentA flowing. */
export function inverterReading(
  fit: WiringFit,
  batteryV: number,
  currentA: number,
): number {
  return batteryV + fit.offsetV + fit.resistanceOhm * currentA;
}
