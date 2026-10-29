/** Mains above this voltage counts as the grid being there. */
export const GRID_PRESENT_V = 100;
/** A low battery is reported again only after it recovers this many points. */
export const RECOVER_POINTS = 5;

export const CHART_WIDTH = 800;
export const CHART_HEIGHT = 450;
export const CHART_PLOT = { left: 70, right: 780, top: 60, bottom: 410 };
export const CHART_FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';

/** How long a logger or BMS reader is silent before it is reported. */
export const OFFLINE_AFTER_MS = 5 * 60_000;
export const DEFAULT_LOW_SOC = 20;

export const POLL_TIMEOUT_SECONDS = 30;
export const RETRY_AFTER_ERROR_MS = 5_000;

/** No 0/O, 1/I/L: easy to read out and type. */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 8;
export const LINK_VALID_FOR_MS = 10 * 60_000;

export const SUMMARY_DEFAULT_TIME = '21:00';
