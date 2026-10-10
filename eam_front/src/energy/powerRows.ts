import type { History } from '../history/historyRange';

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

/** History points as kW rows; a value missing from a point stays null so the chart shows a gap. */
export function toPowerRows(history: History): PowerRow[] {
  return history.points.map(({ timestamp, values }) => {
    const kw = (name: string) => (typeof values[name] === 'number' ? values[name] / 1000 : null);
    const amps = values.BatteryCurrentSigned;
    const volts = values.BatteryVoltage;
    return {
      at: Date.parse(timestamp),
      pv: kw('PVPower'),
      load: kw('OutputActivePower'),
      grid: kw('AverageMainsPower'),
      battery: typeof amps === 'number' && typeof volts === 'number' ? (amps * volts) / 1000 : null,
      soc: typeof values.BatterySoc === 'number' ? values.BatterySoc : null,
    };
  });
}
