/** How often the agent measures the disk each service and container takes (du and Docker's sizes are slow). */
export const DISK_EVERY_MS = 10 * 60_000;

export const UPDATES_MAX_NAMES = 100;

/** A rule is left only this far below its threshold, so the fan does not flap. */
export const HYSTERESIS_C = 3;
