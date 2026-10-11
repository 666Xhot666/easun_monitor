import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Temperature {
  /** The hwmon device's name, e.g. coretemp. */
  device: string;
  /** The sensor's label, or tempN when it has none. */
  label: string;
  celsius: number;
}

export interface Fan {
  device: string;
  label: string;
  rpm: number;
}

const read = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
};

/** Every temperature and fan under /sys/class/hwmon; unreadable ones are skipped. */
export function readSensors(root: string): {
  temperatures: Temperature[];
  fans: Fan[];
} {
  const base = join(root, 'sys/class/hwmon');
  let entries: string[];
  try {
    entries = readdirSync(base).sort((a, b) =>
      a.localeCompare(b, 'en', { numeric: true }),
    );
  } catch {
    return { temperatures: [], fans: [] };
  }
  const temperatures: Temperature[] = [];
  const fans: Fan[] = [];
  for (const entry of entries) {
    const dir = join(base, entry);
    const device = read(join(dir, 'name')) ?? entry;
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    const inputs = files
      .map((f) => /^(temp|fan)(\d+)_input$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => a[1].localeCompare(b[1]) || Number(a[2]) - Number(b[2]));
    for (const [file, kind, n] of inputs) {
      const raw = read(join(dir, file));
      const value = Number(raw);
      if (!raw || !Number.isFinite(value)) continue;
      const label = read(join(dir, `${kind}${n}_label`)) || `${kind}${n}`;
      if (kind === 'temp') {
        temperatures.push({
          device,
          label,
          celsius: Math.round(value / 100) / 10,
        });
      } else {
        fans.push({ device, label, rpm: value });
      }
    }
  }
  return { temperatures, fans };
}
