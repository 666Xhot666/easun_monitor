/**
 * Shape of one successfully decoded telemetry snapshot from the inverter.
 *
 * The parameter set is sourced dynamically from commands.json (~85
 * registers) rather than a fixed list, and any individual register can be
 * skipped on a given poll if it times out or fails to parse — so the keys
 * present on a given reading are not guaranteed to be the same from cycle
 * to cycle. This is persisted as-is into the InverterLog.payload Json
 * column.
 */
export type InverterReading = Record<string, number>;
