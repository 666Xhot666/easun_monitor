/** What a service or container takes; null when it could not be read. Absent from older agents. */
export interface Usage {
  memoryBytes?: number | null;
  /** As a share of one core. */
  cpuPercent?: number | null;
  diskBytes?: number | null;
}

export interface Battery {
  name: string;
  model: string | null;
  status: string | null;
  percent: number | null;
  /** What it holds when full now, against when new. */
  healthPercent: number | null;
  nowWh: number | null;
  fullWh: number | null;
  designWh: number | null;
  voltageV: number | null;
  /** Below zero while discharging. */
  powerW: number | null;
  cycles: number | null;
}

/** One reading of the host by the server agent. */
export interface HostSample {
  at: string;
  uptimeSeconds: number;
  cpu: { usagePercent: number | null; coresPercent: number[]; load: [number, number, number] };
  memory: { totalBytes: number; availableBytes: number; swapTotalBytes: number; swapFreeBytes: number };
  disks: Array<{ mount: string; totalBytes: number; freeBytes: number }>;
  network: Array<{ name: string; rxBytesPerSecond: number | null; txBytesPerSecond: number | null }>;
  temperatures: Array<{ device: string; label: string; celsius: number }>;
  fans: Array<{ device: string; label: string; rpm: number }>;
  /** Absent from older agents. */
  power?: { onMains: boolean | null; batteries: Battery[] };
  services: Array<{ name: string; active: boolean } & Usage> | null;
  containers: Array<{ name: string; state: string; status: string } & Usage> | null;
  /** Package updates, as of apt's last list refresh; absent when the agent does not check. */
  updates?: {
    checkedAt: string;
    packages: number;
    security: number;
    names: string[];
    listsUpdatedAt: string | null;
    rebootRequired: boolean;
  } | null;
}

/** GET /api/server/status. */
export interface ServerStatus {
  agent: { configured: boolean; lastSeenAt: string | null };
  sample: HostSample | null;
  /** No sample for 3 minutes. */
  stale: boolean;
}
