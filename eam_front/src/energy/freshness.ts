/** live: a recent reading. stale: the newest reading is too old to trust as
 * "now" (kept on screen, greyed). offline: no reading at all. */
export type FlowFreshness = 'live' | 'stale' | 'offline';

export function flowFreshness(
  timestamp: string | undefined,
  nowMs: number,
  staleAfterMs: number,
): FlowFreshness {
  if (!timestamp) return 'offline';
  return nowMs - Date.parse(timestamp) > staleAfterMs ? 'stale' : 'live';
}

const UNITS: [suffix: string, ms: number][] = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
];

/** "4s", "2m", "3h", "2d": the largest whole unit of an age. */
export function formatAge(ms: number): string {
  for (const [suffix, size] of UNITS) {
    if (ms >= size) return `${Math.floor(ms / size)}${suffix}`;
  }
  return `${Math.max(0, Math.floor(ms / 1000))}s`;
}
