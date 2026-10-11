import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CpuTicks {
  busy: number;
  idle: number;
}

export interface CpuTimes {
  total: CpuTicks;
  cores: CpuTicks[];
}

/** One /proc/stat cpu line: user nice system idle iowait irq softirq steal ... */
function ticks(line: string): CpuTicks {
  const [user, nice, system, idle, iowait, irq, softirq, steal] = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((v) => parseInt(v, 10) || 0);
  const n = (v: number | undefined) => v ?? 0;
  return {
    busy: n(user) + n(nice) + n(system) + n(irq) + n(softirq) + n(steal),
    idle: n(idle) + n(iowait),
  };
}

/** Reads /proc/stat and returns total and per-core CPU tick counts. */
export function readCpuTimes(root: string): CpuTimes {
  const lines = readFileSync(join(root, 'proc/stat'), 'utf8').split('\n');
  const total = lines.find((line) => line.startsWith('cpu '));
  return {
    total: total ? ticks(total) : { busy: 0, idle: 0 },
    cores: lines.filter((line) => /^cpu\d+ /.test(line)).map(ticks),
  };
}

/** Calculates CPU usage percentage between two CpuTimes samples. */
export function cpuUsage(
  before: CpuTimes,
  after: CpuTimes,
): { usagePercent: number; coresPercent: number[] } {
  const calcPercent = (b: CpuTicks, a: CpuTicks): number => {
    const deltaBusy = a.busy - b.busy;
    const deltaIdle = a.idle - b.idle;
    const totalDelta = deltaBusy + deltaIdle;
    if (totalDelta <= 0) return 0;
    const pct = (deltaBusy / totalDelta) * 100;
    return Math.round(pct * 10) / 10;
  };

  const usagePercent = calcPercent(before.total, after.total);

  const coresPercent: number[] = [];
  const minLen = Math.min(before.cores.length, after.cores.length);
  for (let i = 0; i < minLen; i++) {
    coresPercent.push(calcPercent(before.cores[i], after.cores[i]));
  }

  return { usagePercent, coresPercent };
}

/** Reads the 1, 5, and 15 minute load averages from /proc/loadavg. */
export function readLoad(root: string): [number, number, number] {
  const content = readFileSync(join(root, 'proc/loadavg'), 'utf8');
  const parts = content.split(/\s+/);
  return [
    parseFloat(parts[0]) || 0,
    parseFloat(parts[1]) || 0,
    parseFloat(parts[2]) || 0,
  ];
}

/** Reads the system uptime in whole seconds from /proc/uptime. */
export function readUptime(root: string): number {
  const content = readFileSync(join(root, 'proc/uptime'), 'utf8');
  const first = content.split(/\s+/)[0];
  return Math.floor(parseFloat(first) || 0);
}

/** Reads memory and swap statistics from /proc/meminfo. */
export function readMemory(root: string): {
  totalBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
} {
  const content = readFileSync(join(root, 'proc/meminfo'), 'utf8');
  const lines = content.split('\n');
  let totalBytes = 0;
  let availableBytes = 0;
  let swapTotalBytes = 0;
  let swapFreeBytes = 0;

  for (const line of lines) {
    const match = line.match(/^(\w+):\s+(\d+)\s+kB$/);
    if (!match) continue;
    const key = match[1];
    const val = parseInt(match[2], 10) * 1024;

    if (key === 'MemTotal') totalBytes = val;
    else if (key === 'MemAvailable') availableBytes = val;
    else if (key === 'SwapTotal') swapTotalBytes = val;
    else if (key === 'SwapFree') swapFreeBytes = val;
  }

  return { totalBytes, availableBytes, swapTotalBytes, swapFreeBytes };
}

export interface NetCounter {
  name: string;
  rxBytes: number;
  txBytes: number;
}

/** Reads network interface byte counters from /proc/net/dev, filtering out virtual interfaces. */
export function readNetCounters(root: string): NetCounter[] {
  // Network cards have a device behind them; tunnels, bridges and Docker's
  // veths do not. Without /sys, go by Docker's and the loopback's names.
  const sysNet = join(root, 'sys/class/net');
  const physical = existsSync(sysNet)
    ? (name: string) => existsSync(join(sysNet, name, 'device'))
    : (name: string) => name !== 'lo' && !/^(veth|br-|docker)/.test(name);
  const content = readFileSync(join(root, 'proc/net/dev'), 'utf8');
  const lines = content.split('\n');
  const counters: NetCounter[] = [];

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const name = line.slice(0, colonIdx).trim();
    if (!physical(name)) continue;

    const rest = line.slice(colonIdx + 1).trim();
    const fields = rest.split(/\s+/);
    const rxBytes = parseInt(fields[0], 10) || 0;
    const txBytes = parseInt(fields[8], 10) || 0;

    counters.push({ name, rxBytes, txBytes });
  }

  return counters;
}

/** Calculates per-interface byte rates between two NetCounter samples. */
export function netRates(
  before: NetCounter[],
  after: NetCounter[],
  seconds: number,
): Array<{
  name: string;
  rxBytesPerSecond: number | null;
  txBytesPerSecond: number | null;
}> {
  const beforeMap = new Map<string, NetCounter>();
  for (const c of before) {
    beforeMap.set(c.name, c);
  }

  const result: Array<{
    name: string;
    rxBytesPerSecond: number | null;
    txBytesPerSecond: number | null;
  }> = [];

  for (const a of after) {
    const b = beforeMap.get(a.name);
    let rxRate: number | null = null;
    let txRate: number | null = null;

    if (b) {
      const deltaRx = a.rxBytes - b.rxBytes;
      const deltaTx = a.txBytes - b.txBytes;

      if (deltaRx >= 0) {
        rxRate = Math.round(deltaRx / seconds);
      }
      if (deltaTx >= 0) {
        txRate = Math.round(deltaTx / seconds);
      }
    }

    result.push({
      name: a.name,
      rxBytesPerSecond: rxRate,
      txBytesPerSecond: txRate,
    });
  }

  return result;
}
