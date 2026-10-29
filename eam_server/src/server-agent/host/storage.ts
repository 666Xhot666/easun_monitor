import type { Run } from './commands';

const UNITS: Record<string, number> = {
  B: 1,
  kB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
};

/** Bytes from a size as Docker writes it ("164kB (virtual 1.08GB)": the first one), or null. */
export function dockerBytes(text: string): number | null {
  const match = /^([\d.]+)\s*(B|kB|MB|GB|TB)/.exec(text.trim());
  if (!match) return null;
  return Math.round(Number(match[1]) * UNITS[match[2]]);
}

/** Each container's disk: its own layer and the named volumes it uses; empty without Docker. */
export async function readContainerDisk(
  run: Run,
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  try {
    const [containers, volumesJson] = await Promise.all([
      run('docker', [
        'ps',
        '-a',
        '--size',
        '--format',
        '{{.Names}}\t{{.Size}}\t{{.Mounts}}',
      ]),
      run('docker', ['system', 'df', '-v', '--format', '{{json .Volumes}}']),
    ]);
    const volumes = new Map<string, number>();
    for (const v of JSON.parse(volumesJson) as Array<{
      Name: string;
      Size: string;
    }>) {
      volumes.set(v.Name, dockerBytes(v.Size) ?? 0);
    }
    for (const line of containers.split('\n')) {
      if (line.trim() === '') continue;
      const [name, size, mounts = ''] = line.split('\t');
      // Folders bound from the host are left out: they are not the container's.
      const inVolumes = mounts
        .split(',')
        .reduce((sum, m) => sum + (volumes.get(m.trim()) ?? 0), 0);
      sizes.set(name, (dockerBytes(size) ?? 0) + inVolumes);
    }
  } catch {
    sizes.clear();
  }
  return sizes;
}

/** The size of each unit's working folder; a unit without one, or one that cannot be measured, is left out. */
export async function readServiceDisk(
  run: Run,
  units: string[],
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (const unit of units) {
    try {
      const dir = (
        await run('systemctl', [
          'show',
          '-p',
          'WorkingDirectory',
          '--value',
          unit,
        ])
      ).trim();
      if (!dir.startsWith('/')) continue;
      const bytes = Number((await run('du', ['-sb', dir])).split('\t')[0]);
      if (Number.isFinite(bytes)) sizes.set(unit, bytes);
    } catch {
      // Not measured this time.
    }
  }
  return sizes;
}
