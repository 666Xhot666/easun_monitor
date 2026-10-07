import type { RegisterMap } from '../inverter/registers/register-map';
import type { EnergyTotals } from '../telemetry/telemetry.store';

/** Battery power within this many watts counts as idle. */
const IDLE_W = 10;

const watts = (w: number | undefined) =>
  w === undefined
    ? '--'
    : Math.abs(w) >= 1000
      ? `${(w / 1000).toFixed(2)} kW`
      : `${Math.round(w)} W`;

const kWh = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)} kWh`;

const age = (from: Date, now: Date) => {
  const minutes = Math.floor((now.getTime() - from.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
};

/** /status for one inverter: mode and age, power flow, battery. */
export function formatStatus(
  name: string,
  map: RegisterMap,
  reading: { timestamp: Date; payload: Record<string, number> } | null,
  now: Date,
): string {
  if (!reading) return `${name}: no readings yet`;
  const p = reading.payload;
  const mode = map.get('OperationMode')?.options?.[p.OperationMode];
  const head = `${name}: ${mode ? `${mode}, ` : ''}${age(reading.timestamp, now)}`;
  const flow = `PV ${watts(p.PVPower)} · Load ${watts(p.OutputActivePower)} · Grid ${watts(p.AverageMainsPower)}`;
  const lines = [head, flow];
  if (p.BatterySoc !== undefined) {
    const batteryW =
      p.BatteryVoltage !== undefined && p.BatteryCurrentSigned !== undefined
        ? p.BatteryVoltage * p.BatteryCurrentSigned
        : undefined;
    const state =
      batteryW === undefined
        ? ''
        : Math.abs(batteryW) <= IDLE_W
          ? ', idle'
          : `, ${batteryW > 0 ? 'charging' : 'discharging'} ${watts(Math.abs(batteryW))}`;
    lines.push(`Battery ${Math.round(p.BatterySoc)} %${state}`);
  }
  return lines.join('\n');
}

/** /energy for one inverter: today's totals. */
export function formatEnergy(name: string, totals: EnergyTotals): string {
  return (
    `${name} today: PV ${kWh(totals.pvKWh)} · Grid ${kWh(totals.gridKWh)} · Load ${kWh(totals.outputKWh)} · ` +
    `Battery +${totals.batteryChargeKWh.toFixed(2)} / -${totals.batteryDischargeKWh.toFixed(2)} kWh`
  );
}

/** The wall-clock time in `timeZone`, read as if it were UTC (ms). */
function wallClockAsUtc(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
}

/** Local midnight of `now`'s day in `timeZone`, as an instant. */
export function dayStart(now: Date, timeZone: string): Date {
  const local = new Date(wallClockAsUtc(now, timeZone));
  const midnightAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  // Shift by the zone's offset at that moment; twice to settle across a DST change.
  let guess = midnightAsUtc;
  for (let i = 0; i < 2; i++) {
    guess = midnightAsUtc - (wallClockAsUtc(new Date(guess), timeZone) - guess);
  }
  return new Date(guess);
}

/** HH:MM of `at` in `timeZone`. */
export function clockTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/** A length of time in whole minutes (at least 1), with hours from an hour on. */
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
