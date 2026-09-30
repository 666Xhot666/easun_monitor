import { useCallback, useEffect, useRef, useState } from 'react';
import axios from '../lib/apiClient';
import type { LatestReading } from './types';

/**
 * loading: first request for this profile in flight.
 * live: a recent reading.
 * stale: the newest reading is older than `staleAfterMs` (the server
 *   can't reach the inverter, or the poller stopped).
 * no-data: the server has no reading for this profile yet.
 * unreachable: the API itself can't be reached; the last reading, if any,
 *   is kept on screen.
 */
export type ReadingStatus = 'loading' | 'live' | 'stale' | 'no-data' | 'unreachable';

export interface UseReadingOptions {
  /** Poll interval; 0 fetches once (call `refresh` to fetch again). */
  pollMs?: number;
  staleAfterMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export const DEFAULT_POLL_MS = 5000;
const DEFAULT_STALE_AFTER_MS = 60_000;

/** The latest Reading for one inverter profile, with a single status model
 * shared by every screen that shows live values. */
export function useReading(profileId: number, options: UseReadingOptions = {}) {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const now = options.now ?? Date.now;

  const [reading, setReading] = useState<LatestReading | null>(null);
  const [fetched, setFetched] = useState<'loading' | 'ok' | 'no-data' | 'unreachable'>('loading');
  // Guards against a slow response for a previous profile landing late.
  const currentProfile = useRef(profileId);

  const fetchLatest = useCallback(async () => {
    const id = profileId;
    try {
      const { data } = await axios.get<LatestReading>(`/api/inverter/${id}/latest`);
      if (currentProfile.current !== id) return;
      setReading(data);
      setFetched('ok');
    } catch (error) {
      if (currentProfile.current !== id) return;
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        setReading(null);
        setFetched('no-data');
      } else {
        setFetched('unreachable');
      }
    }
  }, [profileId]);

  useEffect(() => {
    currentProfile.current = profileId;
    // No profile selected yet (the dashboard passes 0 while redirecting).
    if (profileId <= 0) return;
    let cancelled = false;
    const run = async () => {
      if (!cancelled) await fetchLatest();
    };
    // Reset for the new profile inside the async callback, not the effect
    // body, to keep react-hooks' set-state-in-effect rule happy.
    void (async () => {
      setReading(null);
      setFetched('loading');
      await run();
    })();
    const interval = pollMs > 0 ? setInterval(run, pollMs) : undefined;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [profileId, pollMs, fetchLatest]);

  let status: ReadingStatus;
  if (fetched !== 'ok') {
    status = fetched;
  } else if (reading && now() - Date.parse(reading.timestamp) > staleAfterMs) {
    status = 'stale';
  } else {
    status = 'live';
  }

  return { reading, status, refresh: fetchLatest };
}
