import { useCallback, useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import type { BmsDevice } from './types';

const fetchDevices = async (profileId: number): Promise<BmsDevice[]> =>
  (await axios.get<BmsDevice[]>(`/api/inverter/profiles/${profileId}/bms`)).data;

/** The inverter's BMS devices; null until loaded. `reload` fetches them again. */
export function useBmsDevices(profileId: number) {
  const [devices, setDevices] = useState<BmsDevice[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setDevices(await fetchDevices(profileId));
    } catch {
      setDevices((current) => current ?? []);
    }
  }, [profileId]);
  useEffect(() => {
    // No profile selected yet (the dashboard passes 0 while redirecting).
    if (profileId <= 0) return;
    let cancelled = false;
    fetchDevices(profileId)
      .then((data) => {
        if (!cancelled) setDevices(data);
      })
      .catch(() => {
        if (!cancelled) setDevices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);
  return { devices, reload };
}
