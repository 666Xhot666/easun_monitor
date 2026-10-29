/** Lists longer than this are not a real host's; the sample is refused. */
export const SAMPLE_MAX_ITEMS = 256;
export const SAMPLE_MAX_TEXT = 200;

/** Without a sample for this long, the server page says the agent is silent. */
export const AGENT_STALE_MS = 3 * 60_000;
/** Samples are kept this long. */
export const KEEP_SAMPLES_MS = 30 * 24 * 60 * 60_000;

/** The ranges the history offers: how far back, in buckets of how long. */
export const HISTORY_RANGES = {
  '24h': { spanMs: 24 * 60 * 60_000, bucketSeconds: 300 },
  '7d': { spanMs: 7 * 24 * 60 * 60_000, bucketSeconds: 3600 },
} as const;

/** The agent counts as silent after this long without a sample. */
export const SILENT_AFTER_MS = 5 * 60_000;
export const RECENT_EVENTS = 30;

/** Overheating needs this many hot readings in a row; memory this many over the limit. */
export const HOT_READINGS = 2;
export const MEMORY_READINGS = 5;
/** How far back below (or above, for free storage) the limit a notice is over. */
export const HEAT_MARGIN_C = 5;
export const STORAGE_MARGIN = 2;
export const MEMORY_MARGIN = 5;

export const FAN_MAX_RULES = 10;
export const FAN_MAX_C = 120;
