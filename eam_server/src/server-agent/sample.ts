import type { Container, Service } from './host/commands';
import type { Disk } from './host/disks';
import type { Fan, Temperature } from './host/sensors';

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
  /** The systemd units watched; null when systemd could not be asked. */
  services: Service[] | null;
  /** null when Docker could not be asked. */
  containers: Container[] | null;
}
