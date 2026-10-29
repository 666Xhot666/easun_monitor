import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CgroupReading {
  /** In use, less the page cache the kernel can drop (as `docker stats` counts it). */
  memoryBytes: number;
  /** CPU time used since the cgroup began. */
  cpuUsec: number;
}

/** The cgroup (v2) of a systemd unit; a bare name is a service. */
export const serviceCgroup = (unit: string) =>
  `system.slice/${/\.[a-z]+$/.test(unit) ? unit : `${unit}.service`}`;

/** The cgroup Docker (with systemd) runs a container in, by its full id. */
export const containerCgroup = (id: string) =>
  `system.slice/docker-${id}.scope`;

const stat = (text: string, key: string): number | null => {
  const line = text.split('\n').find((l) => l.startsWith(`${key} `));
  const value = line ? Number(line.slice(key.length + 1)) : NaN;
  return Number.isFinite(value) ? value : null;
};

/** A cgroup's memory and CPU time; null when it is not there (the unit is stopped). */
export function readCgroup(root: string, cgroup: string): CgroupReading | null {
  const dir = join(root, 'sys/fs/cgroup', cgroup);
  try {
    const current = Number(readFileSync(join(dir, 'memory.current'), 'utf8'));
    const memoryStat = readFileSync(join(dir, 'memory.stat'), 'utf8');
    const cpuUsec = stat(
      readFileSync(join(dir, 'cpu.stat'), 'utf8'),
      'usage_usec',
    );
    if (!Number.isFinite(current) || cpuUsec === null) return null;
    const cache = stat(memoryStat, 'inactive_file') ?? 0;
    return { memoryBytes: Math.max(0, current - cache), cpuUsec };
  } catch {
    return null;
  }
}

/** CPU use between two readings `seconds` apart, as a share of one core; null without both, or after a restart. */
export function cgroupCpuPercent(
  before: CgroupReading | null,
  after: CgroupReading,
  seconds: number,
): number | null {
  if (!before || seconds <= 0 || after.cpuUsec < before.cpuUsec) return null;
  const percent = ((after.cpuUsec - before.cpuUsec) / (seconds * 1e6)) * 100;
  return Math.round(percent * 10) / 10;
}
