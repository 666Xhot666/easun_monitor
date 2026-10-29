/** GET /api/inverter/:profileId/energy response. */
export interface EnergyTotals {
  pvKWh: number;
  gridKWh: number;
  outputKWh: number;
  /** Energy into and out of the battery, at its terminals. */
  batteryChargeKWh: number;
  batteryDischargeKWh: number;
  /** How much of the range had readings close enough together to integrate. */
  coveredSeconds: number;
}
