/** Watts below this count as idle: no line, no animation. */
export const DEADBAND_W = 10;

/** Below this share of a day with readings, the totals say how much they cover. */
export const FULL_COVERAGE = 0.95;
export const TOTALS_REFRESH_MS = 60_000;

export const LAST_24H_REFRESH_MS = 5 * 60_000;

/** Battery current below this many amps counts as idle: no time to full or empty. */
export const IDLE_A = 0.5;

/** Mains voltage above this means the grid is there, used or not. */
export const GRID_PRESENT_MIN_V = 90;
