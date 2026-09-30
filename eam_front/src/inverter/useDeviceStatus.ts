import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import { DEFAULT_POLL_MS } from './useReading';

/** GET /api/inverter/:profileId/status: the poller's link to the logger. */
export interface DeviceStatus {
  state: 'online' | 'backoff' | 'offline';
  lastSuccessAt: string | null;
  lastError: string | null;
  retryAt: string | null;
}

/** Polls the logger link status for a profile; null until first loaded or
 * when the API can't be reached (useReading reports that case). */
export function useDeviceStatus(profileId: number, pollMs = DEFAULT_POLL_MS): DeviceStatus | null {
  const [status, setStatus] = useState<DeviceStatus | null>(null);

  useEffect(() => {
    if (profileId <= 0) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await axios.get<DeviceStatus>(`/api/inverter/${profileId}/status`);
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    void load();
    const interval = pollMs > 0 ? setInterval(load, pollMs) : undefined;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [profileId, pollMs]);

  return status;
}

/** A one-line explanation for the dashboard, or null when all is well. */
export function describeDeviceStatus(status: DeviceStatus, now: number = Date.now()): string | null {
  if (status.state === 'online') return null;
  if (status.state === 'backoff') {
    const seconds = status.retryAt
      ? Math.max(0, Math.ceil((Date.parse(status.retryAt) - now) / 1000))
      : null;
    const reason = status.lastError ? ` (${status.lastError})` : '';
    return `Inverter logger unreachable${reason}.${seconds === null ? '' : ` Retrying in ${seconds} s.`}`;
  }
  return status.lastError
    ? `Inverter logger unreachable (${status.lastError}). Retrying now.`
    : 'Waiting for the first contact with the inverter logger.';
}
