/** A reading older than this is stale, never shown as current. */
export const STALE_AFTER_MS = 30_000;
export const DEFAULT_HISTORY_POINTS = 300;
export const DEFAULT_HISTORY_SPAN_MS = 60 * 60 * 1000;
export const MAX_HISTORY_SPAN_MS = 5 * 366 * 24 * 60 * 60 * 1000;
/** The longest range one export may cover. */
export const MAX_EXPORT_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

export const DEFAULT_STORE_INTERVAL_MS = 30_000;
/** Clock skew allowed for a producer's timestamp. */
export const MAX_FUTURE_MS = 60_000;
/** Oldest reading accepted: the reader queues a few minutes while the server is down. */
export const MAX_AGE_MS = 3_600_000;
/** Per device: twice what a producer posting every second would send. */
export const INGEST_RATE_LIMIT = { requests: 120, windowMs: 60_000 };

/** How often the hourly averages catch up with new readings. */
export const ROLLUP_INTERVAL_MS = 10 * 60_000;

/** Plausible limits: up to 32 LiFePO4 cells, a few hundred amperes. */
export const MAX_PACK_V = 150;
export const MAX_CURRENT_A = 1000;
export const MAX_CELL_V = 5;
export const MAX_CELLS = 32;
