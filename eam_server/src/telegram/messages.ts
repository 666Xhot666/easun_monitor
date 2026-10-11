import { LOCALES, type Language } from '../i18n/languages';
import { translate } from '../i18n/translate';
import type { EnergyTotals } from '../telemetry/telemetry.store';

/** One inverter's day in plain text, for the evening summary. */
export function formatEnergy(
  name: string,
  totals: EnergyTotals,
  language: Language,
): string {
  const fixed = (value: number, decimals: number) =>
    new Intl.NumberFormat(LOCALES[language], {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    }).format(value);
  const unit = translate(language, 'units.kWh');
  const kWh = (value: number) => `${fixed(value, value < 10 ? 2 : 1)} ${unit}`;
  return translate(language, 'telegram.energyLine', {
    name,
    pv: kWh(totals.pvKWh),
    grid: kWh(totals.gridKWh),
    load: kWh(totals.outputKWh),
    charged: fixed(totals.batteryChargeKWh, 2),
    used: fixed(totals.batteryDischargeKWh, 2),
    kWh: unit,
  });
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
