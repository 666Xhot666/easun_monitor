/** Without a successful check for this long, the data is stale. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** A battery level older than this is left out of the reminder. */
export const SOC_FRESH_MS = 10 * 60_000;

/** A check asked for in the app comes at most this often. */
export const STREETS_REFRESH_EVERY_MS = 5 * 60_000;
