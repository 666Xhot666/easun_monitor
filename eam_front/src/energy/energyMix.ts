import type { EnergyTotals } from '@eam/shared/energy';

export type { EnergyTotals };

/** Where the load's energy came from, in kWh: grid first, then battery, the rest solar used directly. */
export function loadSources(t: Pick<EnergyTotals, 'gridKWh' | 'outputKWh' | 'batteryDischargeKWh'>): {
  solar: number;
  battery: number;
  grid: number;
} {
  const grid = Math.min(t.gridKWh, t.outputKWh);
  const battery = Math.min(t.batteryDischargeKWh, t.outputKWh - grid);
  return { solar: Math.max(0, t.outputKWh - grid - battery), battery, grid };
}

/** Share of the load not taken from the grid, in whole percent; undefined without load. */
export function selfSufficiency(t: Pick<EnergyTotals, 'gridKWh' | 'outputKWh'>): number | undefined {
  return t.outputKWh > 0 ? Math.round((1 - Math.min(t.gridKWh, t.outputKWh) / t.outputKWh) * 100) : undefined;
}
