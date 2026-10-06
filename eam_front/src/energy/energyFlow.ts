import { utilization } from '../solar/pvArray';

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
  /** Battery only: whether the values come from the BMS or the inverter. */
  source?: 'bms' | 'inverter';
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
  /** The solar array's rated power; adds utilization to the PV value. */
  pvRatedW?: number;
  /**
   * A live BMS reading for the battery: its state of charge and power
   * (positive while charging). Replaces the inverter's estimate.
   */
  bms?: { stateOfChargePct: number | null; powerW: number | null };
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
  const pvShare = pvActive ? utilization(pvW, options.pvRatedW) : undefined;

  const gridW = read('AverageMainsPower');
  const mainsV = read('MainsVoltage');

  // BatteryCurrentSigned is + while charging, - while discharging; so is the BMS's power.
  const fromBms = options.bms !== undefined;
  const batteryA = read('BatteryCurrentSigned');
  const batteryV = read('BatteryVoltage');
  const soc = fromBms ? (options.bms?.stateOfChargePct ?? undefined) : read('BatterySoc');
  const batteryW = fromBms
    ? (options.bms?.powerW ?? undefined)
    : batteryA !== undefined && batteryV !== undefined
      ? batteryA * batteryV
      : undefined;

  const loadW = read('OutputActivePower');

  return {
    pv: {
      value: pvShare === undefined ? formatPower(pvW) : `${formatPower(pvW)} · ${pvShare}%`,
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
      source: fromBms ? 'bms' : 'inverter',
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

const SLOWEST_DOTS_S = 2.5;
const FASTEST_DOTS_S = 0.4;

/** Seconds for the dots to move one gap: faster for more watts, on a log
 * scale so 100 W and 3 kW both look alive. */
export function dotDurationS(watts: number | undefined): number {
  if (watts === undefined || watts <= 10) return SLOWEST_DOTS_S;
  const seconds = 3 - 0.7 * Math.log10(watts);
  return Math.round(Math.min(SLOWEST_DOTS_S, Math.max(FASTEST_DOTS_S, seconds)) * 100) / 100;
}
