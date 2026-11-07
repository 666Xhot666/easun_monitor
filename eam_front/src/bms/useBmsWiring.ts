import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import { INVERTER_CUTOFF_SETTING } from './constants';
import type { BmsWiring } from './types';

/**
 * The wiring fit of one BMS, fetched once per device; null while loading or when it fails.
 */
export function useBmsWiring(profileId: number, bmsId: number | null): BmsWiring | null {
  const [loaded, setLoaded] = useState<{ key: string; wiring: BmsWiring } | null>(null);
  const key = `${profileId}/${bmsId}`;

  useEffect(() => {
    if (bmsId === null) return;
    let cancelled = false;
    async function load() {
      try {
        const { data } = await axios.get<BmsWiring>(`/api/inverter/profiles/${profileId}/bms/${bmsId}/wiring`);
        if (!cancelled) setLoaded({ key: `${profileId}/${bmsId}`, wiring: data });
      } catch {
        /* shown as nothing */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [profileId, bmsId]);

  return bmsId !== null && loaded?.key === key ? loaded.wiring : null;
}

/**
 * The inverter's low DC cut-off voltage from its last read settings; null while unknown (loading, not readable for this user, or not read yet).
 */
export function useInverterCutoff(profileId: number): number | null {
  const [loaded, setLoaded] = useState<{ profileId: number; value: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data } = await axios.get<{ values: Record<string, number> }>(`/api/inverter/${profileId}/settings`);
        const value = data.values[INVERTER_CUTOFF_SETTING];
        if (!cancelled && typeof value === 'number') setLoaded({ profileId, value });
      } catch {
        /* unknown */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  return loaded?.profileId === profileId ? loaded.value : null;
}
