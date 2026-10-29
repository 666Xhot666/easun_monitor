import type { Container, Service } from './host/commands';
import type { FanControlState } from './fan/fan-controller';
import type { Disk } from './host/disks';
import type { Power } from './host/power';
import type { Fan, Temperature } from './host/sensors';
import type { Updates } from './host/updates';

/** What a service or container takes; each null when it could not be read (stopped, or not measured yet). */
export interface Usage {
  /** In use, less the page cache the kernel can drop. */
  memoryBytes: number | null;
  /** Since the previous reading, as a share of one core. */
  cpuPercent: number | null;
  /** Its folder (a service) or its layer and volumes (a container). */
  diskBytes: number | null;
}

/** What the agent reports about the host once a cycle. */
export interface HostSample {
  /** When it was read (ISO). */
  at: string;
  uptimeSeconds: number;
  cpu: {
    /** Since the previous reading; null on the first. */
    usagePercent: number | null;
    coresPercent: number[];
    /** 1, 5 and 15 minute load averages. */
    load: [number, number, number];
  };
  memory: {
    totalBytes: number;
    availableBytes: number;
    swapTotalBytes: number;
    swapFreeBytes: number;
  };
  disks: Disk[];
  network: Array<{
    name: string;
    rxBytesPerSecond: number | null;
    txBytesPerSecond: number | null;
  }>;
  temperatures: Temperature[];
  fans: Fan[];
  /** Batteries and mains adapter; absent from older agents. */
  power?: Power;
  /** The systemd units watched; null when systemd could not be asked. */
  services: Array<Service & Partial<Usage>> | null;
  /** null when Docker could not be asked. */
  containers: Array<Omit<Container, 'id'> & Partial<Usage>> | null;
  /** Package updates, checked every few hours; absent or null when not checked. */
  updates?: Updates | null;
  /** What the agent did with the fan; absent or null without a fan to control. */
  fanControl?: FanControlState | null;
}
