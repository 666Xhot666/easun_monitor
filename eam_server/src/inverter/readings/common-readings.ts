/**
 * Common readings: what the app shows about any inverter, by names, units
 * and signs that do not depend on the model. Each device maps its own
 * registers to them (devices/<model>/readings.json); stored readings keep
 * the device's raw register values, and are mapped when served.
 *
 * Type-erasable TypeScript only, like the Register map.
 */

export const COMMON_READINGS = [
  /** W from the panels. */
  'pvPower',
  /** V at the PV input. */
  'pvVoltage',
  /** V at the battery. */
  'batteryVoltage',
  /** A: above zero while charging, below while discharging. */
  'batteryCurrent',
  /** W: above zero while charging, below while discharging. */
  'batteryPower',
  /** % state of charge. */
  'batterySoc',
  /** V of the grid (mains) input; 0 without grid. */
  'gridVoltage',
  /** W drawn from the grid. */
  'gridPower',
  /** W the loads take from the inverter's output. */
  'loadPower',
] as const;

export type CommonReading = (typeof COMMON_READINGS)[number];

/** What the inverter is doing. */
export const INVERTER_STATES = [
  /** Starting up. */
  'starting',
  'standby',
  /** The grid powers the loads. */
  'grid',
  /** Solar and battery power the loads. */
  'off-grid',
  /** The loads are passed straight through to the grid. */
  'bypass',
  /** Charging only, output off. */
  'charging',
  'fault',
] as const;

export type InverterState = (typeof INVERTER_STATES)[number];

/** One snapshot in common terms; a reading the device did not give is absent. */
export type CommonSnapshot = Partial<Record<CommonReading, number>> & {
  state?: InverterState;
};
