import i18n from '../i18n';
import { num, unit } from '../i18n/format';
import { DEADBAND_W, GRID_PRESENT_MIN_V, IDLE_A } from './constants';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);


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
  if (active(gridW)) parts.push(t('overview.sentence.onGrid'));
  else if (active(pvW) && discharging) parts.push(t('overview.sentence.onSolarAndBattery'));
  else if (active(pvW)) parts.push(t('overview.sentence.onSolar'));
  else if (discharging) parts.push(t('overview.sentence.onBattery'));

  if (batteryW !== undefined) {
    if (!active(batteryW)) parts.push(t('overview.sentence.batteryIdle'));
    else
      parts.push(
        t(batteryW > 0 ? 'overview.sentence.batteryCharging' : 'overview.sentence.batteryDischarging', {
          power: formatKw(batteryW),
        }),
      );
  }
  if (gridAvailable !== undefined) parts.push(t(gridAvailable ? 'overview.sentence.gridAvailable' : 'overview.sentence.gridDown'));
  return parts.length ? parts.join(' · ') : t('overview.sentence.noData');
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
  if (h === 0) return `${m} ${unit('m')}`;
  return m === 0 ? `${h} ${unit('h')}` : `${h} ${unit('h')} ${m} ${unit('m')}`;
}

/** "2.84 kW" from 1000 W up, "620 W" below, "--" when unknown. */
export function formatKw(watts: number | undefined): string {
  if (watts === undefined || Number.isNaN(watts)) return '--';
  const magnitude = Math.abs(watts);
  return magnitude >= 1000 ? `${num(magnitude / 1000, 2)} ${unit('kW')}` : `${num(Math.round(magnitude))} ${unit('W')}`;
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
  const sources = [
    active(pvW) && t('overview.scene.fromSolar'),
    active(gridW) && t('overview.scene.fromGrid'),
    active(batteryW) && (batteryW ?? 0) < 0 && t('overview.scene.fromBattery'),
  ].filter((s): s is string => Boolean(s));
  const batteryState = t(
    !active(batteryW) ? 'overview.scene.batteryIdle' : (batteryW ?? 0) > 0 ? 'overview.scene.batteryCharging' : 'overview.scene.batteryDischarging',
  );
  const eta = bms ? batteryEta(bms) : null;

  return {
    pv: { value: formatKw(pvW), sub: options.pvRatedW ? t('overview.scene.ofArray', { share: pvShare ?? '--' }) : t('overview.scene.arrayNotSet') },
    grid: {
      value: formatKw(gridW),
      sub: t(active(gridW) ? 'overview.scene.importing' : gridAvailable ? 'overview.scene.standby' : 'overview.scene.notAvailable'),
    },
    load: {
      value: formatKw(loadW),
      sub: sources.length
        ? t('overview.scene.from', { sources: sources.join(t('overview.scene.and')) })
        : t(active(loadW) ? 'overview.scene.powered' : 'overview.scene.idle'),
    },
    battery: {
      value: formatKw(batteryW),
      sub: soc === undefined ? '--' : `${Math.round(soc)}% · ${batteryState}`,
      ...(eta && { extra: t(eta.kind === 'full' ? 'overview.scene.fullIn' : 'overview.scene.emptyIn', { time: formatDuration(eta.hours) }) }),
    },
    watts: { pv: pvW, grid: gridW, load: loadW, battery: batteryW },
    sentence: statusSentence({ pvW, gridW, batteryW, gridAvailable }),
  };
}
