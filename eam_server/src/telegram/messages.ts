import type { EnergyTotals } from '../telemetry/telemetry.store';

const kWh = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)} kWh`;

/** One inverter's day in plain text, for the evening summary. */
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
