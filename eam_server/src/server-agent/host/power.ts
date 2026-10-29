import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Battery {
  /** The kernel's name for it, e.g. BAT0. */
  name: string;
  model: string | null;
  /** Charging, Discharging, Full, Not charging, ... */
  status: string | null;
  percent: number | null;
  /** What it holds when full now, against when new. */
  healthPercent: number | null;
  nowWh: number | null;
  fullWh: number | null;
  designWh: number | null;
  voltageV: number | null;
  /** Into the battery while charging, out of it (below zero) while discharging. */
  powerW: number | null;
  /** null when the battery does not count them (many report 0). */
  cycles: number | null;
}

export interface Power {
  /** Whether a mains adapter is plugged in; null without one to ask. */
  onMains: boolean | null;
  batteries: Battery[];
}

const read = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
};

/** A sysfs number in millionths (µWh, µAh, µV, µW, µA), or null. */
const micro = (dir: string, file: string): number | null => {
  const raw = read(join(dir, file));
  const value = Number(raw);
  return raw && Number.isFinite(value) ? value / 1e6 : null;
};

const round = (v: number | null, decimals: number) =>
  v === null ? null : Math.round(v * 10 ** decimals) / 10 ** decimals;

function battery(dir: string, name: string): Battery {
  const status = read(join(dir, 'status'));
  const capacity = read(join(dir, 'capacity'));
  const cycles = Number(read(join(dir, 'cycle_count')));
  const voltage = micro(dir, 'voltage_now');
  // Batteries count energy (Wh) or charge (Ah); charge becomes energy at the nominal voltage.
  const nominal = micro(dir, 'voltage_min_design') ?? voltage;
  const energy = (kind: string) =>
    micro(dir, `energy_${kind}`) ??
    (() => {
      const ah = micro(dir, `charge_${kind}`);
      return ah !== null && nominal !== null ? ah * nominal : null;
    })();
  const now = energy('now');
  const full = energy('full');
  const design = energy('full_design');
  const current = micro(dir, 'current_now');
  const watts =
    micro(dir, 'power_now') ??
    (current !== null && voltage !== null ? current * voltage : null);
  const sign = status === 'Discharging' ? -1 : 1;
  return {
    name,
    model: read(join(dir, 'model_name')) || null,
    status,
    percent:
      capacity && Number.isFinite(Number(capacity)) ? Number(capacity) : null,
    healthPercent:
      full !== null && design ? round((full / design) * 100, 1) : null,
    nowWh: round(now, 1),
    fullWh: round(full, 1),
    designWh: round(design, 1),
    voltageV: round(voltage, 2),
    powerW: watts === null ? null : round(Math.abs(watts) * sign, 1),
    cycles: Number.isFinite(cycles) && cycles > 0 ? cycles : null,
  };
}

/** The host's batteries and mains adapter, from /sys/class/power_supply; a device's own battery (a mouse's) is left out. */
export function readPower(root: string): Power {
  const base = join(root, 'sys/class/power_supply');
  let entries: string[];
  try {
    entries = readdirSync(base).sort();
  } catch {
    return { onMains: null, batteries: [] };
  }
  let onMains: boolean | null = null;
  const batteries: Battery[] = [];
  for (const name of entries) {
    const dir = join(base, name);
    const type = read(join(dir, 'type'));
    if (type === 'Mains') {
      onMains = (onMains ?? false) || read(join(dir, 'online')) === '1';
    } else if (type === 'Battery' && read(join(dir, 'scope')) !== 'Device') {
      batteries.push(battery(dir, name));
    }
  }
  return { onMains, batteries };
}
