import {
  run as runCommand,
  readContainers,
  readServices,
  type Run,
} from './host/commands';
import {
  cgroupCpuPercent,
  containerCgroup,
  readCgroup,
  serviceCgroup,
  type CgroupReading,
} from './host/cgroups';
import { readDisks } from './host/disks';
import { readPower } from './host/power';
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
import { readContainerDisk, readServiceDisk } from './host/storage';
import { readUpdates, type Updates } from './host/updates';
import type { HostSample, Usage } from './sample';

export interface CollectorOptions {
  /** The folder standing for '/'; tests give a fake one. */
  root?: string;
  /** systemd units to watch. */
  services: string[];
  run?: Run;
  statfs?: Parameters<typeof readDisks>[1];
  /** How often to check for package updates; 0 or absent: never. */
  updatesEveryMs?: number;
  /** How often to measure the disk services and containers take; 0 or absent: never. */
  diskEveryMs?: number;
}

/** Reads the host; CPU use and network traffic are since the previous reading. */
export class Collector {
  private previous: { at: number; cpu: CpuTimes; net: NetCounter[] } | null =
    null;

  private updates: Updates | null = null;
  private updatesAt: number | null = null;

  /** Each service's and container's cgroup at the previous reading, by `service:` or `container:` and its name. */
  private cgroups = new Map<string, CgroupReading>();
  private disk = {
    services: new Map<string, number>(),
    containers: new Map<string, number>(),
  };
  private diskAt: number | null = null;

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
    const diskEvery = this.options.diskEveryMs ?? 0;
    if (
      diskEvery > 0 &&
      (this.diskAt === null || now.getTime() - this.diskAt >= diskEvery)
    ) {
      this.diskAt = now.getTime();
      const [servicesDisk, containersDisk] = await Promise.all([
        readServiceDisk(run, this.options.services),
        containers ? readContainerDisk(run) : new Map<string, number>(),
      ]);
      this.disk = { services: servicesDisk, containers: containersDisk };
    }
    const cgroupsNow = new Map<string, CgroupReading>();
    const usageOf = (
      key: string,
      cgroup: string,
      disk: number | undefined,
    ): Usage => {
      const reading = readCgroup(root, cgroup);
      if (reading) cgroupsNow.set(key, reading);
      return {
        memoryBytes: reading?.memoryBytes ?? null,
        cpuPercent: reading
          ? cgroupCpuPercent(this.cgroups.get(key) ?? null, reading, seconds)
          : null,
        diskBytes: disk ?? null,
      };
    };
    const servicesUsage =
      services?.map((s) => ({
        ...s,
        ...usageOf(
          `service:${s.name}`,
          serviceCgroup(s.name),
          this.disk.services.get(s.name),
        ),
      })) ?? null;
    const containersUsage =
      containers?.map(({ id, ...c }) => ({
        ...c,
        ...usageOf(
          `container:${c.name}`,
          containerCgroup(id),
          this.disk.containers.get(c.name),
        ),
      })) ?? null;
    this.cgroups = cgroupsNow;
    const every = this.options.updatesEveryMs ?? 0;
    if (
      every > 0 &&
      (this.updatesAt === null || now.getTime() - this.updatesAt >= every)
    ) {
      this.updatesAt = now.getTime();
      this.updates = await readUpdates(run, root, now);
    }
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
      power: readPower(root),
      services: servicesUsage,
      containers: containersUsage,
      ...(every > 0 && { updates: this.updates }),
    };
  }
}
