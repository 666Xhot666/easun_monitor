/** Below this many watts a flow counts as idle, so noise doesn't flip the sentence. */
const DEADBAND_W = 10;
/** Battery current below this many amps counts as idle: no time to full or empty. */
const IDLE_A = 0.5;

const active = (watts: number | undefined) => watts !== undefined && Math.abs(watts) > DEADBAND_W;


export interface SystemNow {
  pvW: number | undefined;
  /** Drawn from the grid. */
  gridW: number | undefined;
  /** Positive while charging. */
  batteryW: number | undefined;
  gridAvailable: boolean | undefined;
}

/** One line for the top of the Overview: "On solar · battery charging 1.58 kW · grid available". */
export function statusSentence({ pvW, gridW, batteryW, gridAvailable }: SystemNow): string {
  const parts: string[] = [];
  const discharging = active(batteryW) && (batteryW ?? 0) < 0;
  if (active(gridW)) parts.push('On grid');
  else if (active(pvW) && discharging) parts.push('On solar and battery');
  else if (active(pvW)) parts.push('On solar');
  else if (discharging) parts.push('On battery');

  if (batteryW !== undefined) {
    if (!active(batteryW)) parts.push('battery idle');
    else parts.push(`battery ${batteryW > 0 ? 'charging' : 'discharging'} ${formatKw(batteryW)}`);
  }
  if (gridAvailable !== undefined) parts.push(gridAvailable ? 'grid available' : 'grid down');
  return parts.length ? parts.join(' · ') : 'No data yet';
}

/** Hours until the pack is full (charging) or empty (discharging), from the BMS's own counters. */
export function batteryEta({
  currentA,
  remainingCapacityAh,
  nominalCapacityAh,
}: {
  currentA: number | null;
  remainingCapacityAh: number | null;
  nominalCapacityAh: number | null;
}): { kind: 'full' | 'empty'; hours: number } | null {
  if (currentA === null || remainingCapacityAh === null || nominalCapacityAh === null) return null;
  if (Math.abs(currentA) < IDLE_A) return null;
  return currentA > 0
    ? { kind: 'full', hours: Math.max(0, nominalCapacityAh - remainingCapacityAh) / currentA }
    : { kind: 'empty', hours: remainingCapacityAh / -currentA };
}

/** "2 h 10 m", "45 m", "30 h". */
export function formatDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/** Mains voltage above this means the grid is there, used or not. */
const GRID_PRESENT_MIN_V = 90;

/** "2.84 kW" from 1000 W up, "620 W" below, "--" when unknown. */
export function formatKw(watts: number | undefined): string {
  if (watts === undefined || Number.isNaN(watts)) return '--';
  const magnitude = Math.abs(watts);
  return magnitude >= 1000 ? `${(magnitude / 1000).toFixed(2)} kW` : `${Math.round(magnitude)} W`;
}

export interface SceneValue {
  value: string;
  sub: string;
  extra?: string;
}

export interface SceneValues {
  pv: SceneValue;
  grid: SceneValue;
  load: SceneValue;
  battery: SceneValue;
  /** Watts per flow line; battery + while charging. */
  watts: { pv?: number; grid?: number; load?: number; battery?: number };
  sentence: string;
}

/** A live BMS reading, when the BMS is used for the energy flow. */
export interface BmsNow {
  stateOfChargePct: number | null;
  /** + while charging. */
  powerW: number | null;
  currentA: number | null;
  remainingCapacityAh: number | null;
  nominalCapacityAh: number | null;
}

/** What the Overview's energy flow shows for one reading. */
export function sceneValues(payload: Record<string, number>, options: { pvRatedW?: number; bms?: BmsNow }): SceneValues {
  const read = (name: string): number | undefined => {
    const value = payload[name];
    return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
  };
  const pvW = read('PVPower');
  const gridW = read('AverageMainsPower');
  const loadW = read('OutputActivePower');
  const mainsV = read('MainsVoltage');
  const gridAvailable = mainsV === undefined ? undefined : mainsV > GRID_PRESENT_MIN_V;
  const { bms } = options;
  const amps = read('BatteryCurrentSigned');
  const volts = read('BatteryVoltage');
  const batteryW = bms ? (bms.powerW ?? undefined) : amps !== undefined && volts !== undefined ? amps * volts : undefined;
  const soc = bms ? (bms.stateOfChargePct ?? undefined) : read('BatterySoc');

  const pvShare = pvW !== undefined && options.pvRatedW ? Math.round((Math.max(0, pvW) / options.pvRatedW) * 100) : undefined;
  const sources = [active(pvW) && 'solar', active(gridW) && 'grid', active(batteryW) && (batteryW ?? 0) < 0 && 'battery'].filter(
    (s): s is string => Boolean(s),
  );
  const batteryState = !active(batteryW) ? 'idle' : (batteryW ?? 0) > 0 ? 'charging' : 'discharging';
  const eta = bms ? batteryEta(bms) : null;

  return {
    pv: { value: formatKw(pvW), sub: options.pvRatedW ? `${pvShare ?? '--'}% of array` : 'Array not set up' },
    grid: {
      value: formatKw(gridW),
      sub: active(gridW) ? 'Importing' : gridAvailable ? 'On standby' : 'Not available',
    },
    load: {
      value: formatKw(loadW),
      sub: sources.length ? `From ${sources.join(' and ')}` : active(loadW) ? 'Powered' : 'Idle',
    },
    battery: {
      value: formatKw(batteryW),
      sub: soc === undefined ? '--' : `${Math.round(soc)}% · ${batteryState}`,
      ...(eta && { extra: `${eta.kind === 'full' ? 'Full' : 'Empty'} in ${formatDuration(eta.hours)}` }),
    },
    watts: { pv: pvW, grid: gridW, load: loadW, battery: batteryW },
    sentence: statusSentence({ pvW, gridW, batteryW, gridAvailable }),
  };
}
