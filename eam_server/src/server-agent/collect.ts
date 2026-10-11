import {
  run as runCommand,
  readContainers,
  readServices,
  type Run,
} from './host/commands';
import { readDisks } from './host/disks';
import {
  cpuUsage,
  netRates,
  readCpuTimes,
  readLoad,
  readMemory,
  readNetCounters,
  readUptime,
  type CpuTimes,
  type NetCounter,
} from './host/proc';
import { readSensors } from './host/sensors';
import type { HostSample } from './sample';

export interface CollectorOptions {
  /** The folder standing for '/'; tests give a fake one. */
  root?: string;
  /** systemd units to watch. */
  services: string[];
  run?: Run;
  statfs?: Parameters<typeof readDisks>[1];
}

/** Reads the host; CPU use and network traffic are since the previous reading. */
export class Collector {
  private previous: { at: number; cpu: CpuTimes; net: NetCounter[] } | null =
    null;

  constructor(private readonly options: CollectorOptions) {}

  async sample(now: Date): Promise<HostSample> {
    const root = this.options.root ?? '/';
    const run = this.options.run ?? runCommand;
    const cpu = readCpuTimes(root);
    const net = readNetCounters(root);
    const before = this.previous;
    this.previous = { at: now.getTime(), cpu, net };
    const usage = before ? cpuUsage(before.cpu, cpu) : null;
    const seconds = before ? (now.getTime() - before.at) / 1000 : 0;
    const [services, containers] = await Promise.all([
      readServices(run, this.options.services),
      readContainers(run),
    ]);
    const { temperatures, fans } = readSensors(root);
    return {
      at: now.toISOString(),
      uptimeSeconds: readUptime(root),
      cpu: {
        usagePercent: usage?.usagePercent ?? null,
        coresPercent: usage?.coresPercent ?? [],
        load: readLoad(root),
      },
      memory: readMemory(root),
      disks: readDisks(root, this.options.statfs),
      network:
        before && seconds > 0
          ? netRates(before.net, net, seconds)
          : net.map((n) => ({
              name: n.name,
              rxBytesPerSecond: null,
              txBytesPerSecond: null,
            })),
      temperatures,
      fans,
      services,
      containers,
    };
  }
}
