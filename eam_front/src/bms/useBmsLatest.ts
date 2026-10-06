import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import type { BmsLatest, BmsReading } from './types';

/** A BMS reading older than this is stale, never shown as current. */
export const BMS_STALE_AFTER_MS = 30_000;
const DEFAULT_POLL_MS = 5_000;

/**
 * The latest reading of one BMS device, polled; null while there is none.
 * Freshness is worked out here from the reading's timestamp on every tick,
 * not taken from the server, so a reading turns stale even when the server
 * stops answering.
 */
export function useBmsLatest(
  profileId: number,
  bmsId: number | null,
  options: { pollMs?: number } = {},
): BmsLatest | null {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const [reading, setReading] = useState<BmsReading | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (bmsId === null) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await axios.get<BmsLatest>(`/api/inverter/profiles/${profileId}/bms/${bmsId}/latest`);
        if (!cancelled) setReading(data.reading);
      } catch (error) {
        if (cancelled) return;
        if (axios.isAxiosError(error) && error.response?.status === 404) setReading(null);
        // Other failures keep the last reading; the clock below makes it stale.
      } finally {
        if (!cancelled) setNow(Date.now());
      }
    };
    void load();
    const timer = pollMs > 0 ? setInterval(() => void load(), pollMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [profileId, bmsId, pollMs]);

  if (bmsId === null || !reading) return null;
  const ageMs = Math.max(0, now - Date.parse(reading.timestamp));
  return {
    reading,
    ageSeconds: Math.round(ageMs / 1000),
    status: ageMs <= BMS_STALE_AFTER_MS ? 'live' : 'stale',
  };
}
