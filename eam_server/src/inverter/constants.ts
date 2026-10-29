/** The Wi-Fi Plug Pro's TCP port, used when none is given. */
export const DEFAULT_LOGGER_PORT = 8899;
export const DEFAULT_HISTORY_POINTS = 300;
export const DEFAULT_HISTORY_SPAN_MS = 60 * 60 * 1000;
/** Longest range one history request may cover. */
export const MAX_HISTORY_SPAN_MS = 5 * 366 * 24 * 60 * 60 * 1000;
export const DEFAULT_READINGS_PAGE = 100;
export const DEFAULT_ALERTS_PAGE = 50;
/** The longest range the readings log lists or exports at once. */
export const MAX_READINGS_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

export const LOGGER_BACKOFF = { initialMs: 5_000, maxMs: 5 * 60_000 };

export const DEFAULT_SETTINGS_REFRESH_MS = 5 * 60_000;

/** Unused addresses a single read may span rather than splitting in two. */
export const MAX_BRIDGED_GAP = 8;

export const CAPTURE_MAX_RECENT = 2000;
export const CAPTURE_RETRY_INITIAL_MS = 1000;
export const CAPTURE_RETRY_MAX_MS = 30_000;

export const SETTINGS_MAX_AGE_MS = 5 * 60_000;
