/** A capture file is started anew this often, so old days can be deleted. */
export const CAPTURE_ROTATE_MS = 24 * 3600_000;
/** Captures not written to for this long are deleted. */
export const CAPTURE_KEEP_MS = 14 * 24 * 3600_000;

/** No frame for this long: ask again once; another such silence ends the session. */
export const WATCHDOG_MS = 30_000;
export const WATCHDOG_CHECK_MS = 1_000;
/**
 * Until cell info streams, ask for it this often (the reference asks on its
 * 5 s update cycle until the first cell-info frame). Asking right after the
 * device-info request, while the BMS is still answering it, gets ignored.
 */
export const CELL_INFO_ASK_MS = 5_000;
/** No cell info at all within this long after connecting: reconnect. */
export const FIRST_CELL_INFO_MS = 60_000;

export const INGEST_RETRY_FIRST_MS = 1_000;
export const INGEST_RETRY_MAX_MS = 30_000;

export const RECONNECT_FIRST_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
/** A connection that lasted this long counts as healthy: backoff starts over. */
export const HEALTHY_SESSION_MS = 30_000;

export const SCAN_MS = 10_000;
/** Readings waiting for the server: about five minutes at the send interval. */
export const QUEUE_MINUTES = 5;

/** After a stop signal, the reader exits within this long even if disconnecting hangs. */
export const STOP_GRACE_MS = 5_000;
