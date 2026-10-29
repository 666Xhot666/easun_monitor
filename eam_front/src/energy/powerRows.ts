import type { History } from '../history/historyRange';
import type { CommonReading } from '@eam/shared/readings';

export interface PowerRow {
  at: number;
  /** kW */
  pv: number | null;
  load: number | null;
  grid: number | null;
  /** kW, + charging, − discharging. */
  battery: number | null;
  /** % */
  soc: number | null;
}

/** The common readings the rows need, for ?readings= on the history request. */
export const POWER_READINGS: CommonReading[] = ['pvPower', 'loadPower', 'gridPower', 'batteryPower', 'batterySoc'];

/** History points (in common readings) as kW rows; a value missing from a point stays null so the chart shows a gap. */
export function toPowerRows(history: History): PowerRow[] {
  return history.points.map(({ timestamp, values }) => {
    const kw = (name: CommonReading) => (typeof values[name] === 'number' ? values[name] / 1000 : null);
    return {
      at: Date.parse(timestamp),
      pv: kw('pvPower'),
      load: kw('loadPower'),
      grid: kw('gridPower'),
      battery: kw('batteryPower'),
      soc: typeof values.batterySoc === 'number' ? values.batterySoc : null,
    };
  });
}
