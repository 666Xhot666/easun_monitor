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
/** A new inverter's low-battery alert level (%); each inverter keeps its own (lowSocAlertPct). */
export const DEFAULT_LOW_SOC = 20;

export const POLL_TIMEOUT_SECONDS = 30;
export const RETRY_AFTER_ERROR_MS = 5_000;

/** No 0/O, 1/I/L: easy to read out and type. */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 8;
export const LINK_VALID_FOR_MS = 10 * 60_000;

export const SUMMARY_DEFAULT_TIME = '21:00';
/** A BMS's charge older than this no longer decides a low battery; the inverter's guess does. */
export const BMS_SOC_FRESH_MS = 30_000;
/** Low cell off-grid: by default this far above the BMS's undervoltage recovery voltage, held HOLD_MS; re-armed after recovering by RECOVER_V. */
export const CELL_LOW_ABOVE_RECOVERY_V = 0.1;
export const CELL_LOW_HOLD_MS = 10_000;
export const CELL_LOW_RECOVER_V = 0.05;
