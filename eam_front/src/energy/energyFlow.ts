/** Power as shown on a flow line: "278W", "1.2kW" above 1000 W, "--" when
 * unknown. Always the magnitude; the line's dots show the direction. */
export function formatPower(watts: number | undefined): string {
  if (typeof watts !== 'number' || Number.isNaN(watts)) return '--';
  const magnitude = Math.abs(watts);
  if (magnitude > 1000) return `${(magnitude / 1000).toFixed(1)}kW`;
  return `${Math.round(magnitude)}W`;
}

/** Which way the dots run along a line. */
export type FlowDirection = 'toInverter' | 'fromInverter';

/** One line of the diagram, between the inverter and an outer node. */
export interface FlowConnection {
  /** Text on the line: "278W", "1.2kW", "88%", or "--" when unknown. */
  value: string;
  /** Power above the deadband: the line animates and the value is blue. */
  active: boolean;
  direction: FlowDirection;
  /** The source is there (grid up, sun on the panels): full-brightness icon. */
  available: boolean;
  /** Absolute power, for scaling animation speed; undefined when unknown. */
  watts?: number;
}

export interface EnergyFlow {
  pv: FlowConnection;
  grid: FlowConnection;
  battery: FlowConnection;
  load: FlowConnection;
}

export interface EnergyFlowOptions {
  /** Below this many watts a line counts as idle, so noise doesn't flicker. */
  deadbandW?: number;
}

const DEFAULT_DEADBAND_W = 10;
/** Mains voltage above this means the grid is there, used or not. */
const GRID_PRESENT_MIN_V = 90;

/** Where power is flowing, from one Reading's payload (register name -> value). */
export function computeEnergyFlow(
  payload: Record<string, number> | null,
  options: EnergyFlowOptions = {},
): EnergyFlow {
  const deadbandW = options.deadbandW ?? DEFAULT_DEADBAND_W;
  const read = (name: string): number | undefined => {
    const value = payload?.[name];
    return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
  };
  const isActive = (watts: number | undefined) =>
    watts !== undefined && Math.abs(watts) > deadbandW;

  const pvW = read('PVPower');
  const pvActive = isActive(pvW);

  const gridW = read('AverageMainsPower');
  const mainsV = read('MainsVoltage');

  // BatteryCurrentSigned is + while charging, - while discharging.
  const soc = read('BatterySoc');
  const batteryA = read('BatteryCurrentSigned');
  const batteryV = read('BatteryVoltage');
  const batteryW =
    batteryA !== undefined && batteryV !== undefined ? batteryA * batteryV : undefined;

  const loadW = read('OutputActivePower');

  return {
    pv: {
      value: formatPower(pvW),
      active: pvActive,
      direction: 'toInverter',
      available: pvActive,
      watts: pvW === undefined ? undefined : Math.abs(pvW),
    },
    grid: {
      value: formatPower(gridW),
      active: isActive(gridW),
      direction: gridW !== undefined && gridW < 0 ? 'fromInverter' : 'toInverter',
      available: mainsV !== undefined && mainsV > GRID_PRESENT_MIN_V,
      watts: gridW === undefined ? undefined : Math.abs(gridW),
    },
    battery: {
      value: soc === undefined ? '--' : `${Math.round(soc)}%`,
      active: isActive(batteryW),
      direction: batteryW !== undefined && batteryW > 0 ? 'fromInverter' : 'toInverter',
      available: soc !== undefined,
      watts: batteryW === undefined ? undefined : Math.abs(batteryW),
    },
    load: {
      value: formatPower(loadW),
      active: isActive(loadW),
      direction: 'fromInverter',
      available: loadW !== undefined,
      watts: loadW === undefined ? undefined : Math.abs(loadW),
    },
  };
}
