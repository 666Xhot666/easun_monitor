/** 5-minute buckets over a day. */
export const PEAK_POINTS = 288;

/** The forecast is asked for again this often; the server keeps it for an hour. */
export const FORECAST_REFRESH_MS = 30 * 60_000;

/** Open-circuit voltage rises in the cold; this much headroom below the maximum is kept. */
export const COLD_VOC_MARGIN = 0.15;
