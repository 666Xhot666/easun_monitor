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
  services: Array<{ name: string; active: boolean }> | null;
  containers: Array<{ name: string; state: string; status: string }> | null;
}

/** GET /api/server/status. */
export interface ServerStatus {
  agent: { configured: boolean; lastSeenAt: string | null };
  sample: HostSample | null;
  /** No sample for 3 minutes. */
  stale: boolean;
}
