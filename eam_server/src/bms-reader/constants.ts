/** A capture file is started anew this often, so old days can be deleted. */
export const CAPTURE_ROTATE_MS = 24 * 3600_000;
/** Captures not written to for this long are deleted. */
export const CAPTURE_KEEP_MS = 14 * 24 * 3600_000;
