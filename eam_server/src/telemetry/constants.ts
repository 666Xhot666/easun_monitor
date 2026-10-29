/** Readings further apart than this are not integrated across. */
export const MAX_ENERGY_GAP_SECONDS = 600;
/** How often the hourly rollups catch up with new readings. */
export const ROLLUP_INTERVAL_MS = 10 * 60_000;
