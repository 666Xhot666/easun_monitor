/**
 * Common readings, as the server gives them for any inverter
 * (eam_server/src/inverter/readings/common-readings.ts): the same names,
 * units and signs whatever the model.
 */

export type CommonReading =
  | 'pvPower'
  | 'pvVoltage'
  | 'batteryVoltage'
  /** A, + charging. */
  | 'batteryCurrent'
  /** W, + charging. */
  | 'batteryPower'
  | 'batterySoc'
  /** 0 without grid. */
  | 'gridVoltage'
  /** W drawn from the grid. */
  | 'gridPower'
  | 'loadPower';

export type InverterState = 'starting' | 'standby' | 'grid' | 'off-grid' | 'bypass' | 'charging' | 'fault';

/** One snapshot; a reading the inverter did not give is absent. */
export type CommonSnapshot = Partial<Record<CommonReading, number>> & { state?: InverterState };
