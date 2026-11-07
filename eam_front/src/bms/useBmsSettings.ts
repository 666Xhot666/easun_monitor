import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import type { BmsSettingsReport } from './types';

/**
 * The BMS's own settings as last reported, fetched once per device; null while there are none (404) or while loading. Read-only: the BMS changes them, not this app.
 */
export function useBmsSettings(profileId: number, bmsId: number | null): BmsSettingsReport | null {
  // Tagged with the device it belongs to, so another device's report is never shown.
  const [loaded, setLoaded] = useState<{ key: string; report: BmsSettingsReport } | null>(null);
  const key = `${profileId}/${bmsId}`;

  useEffect(() => {
    if (bmsId === null) return;

    let cancelled = false;

    async function load() {
      try {
        const { data } = await axios.get<BmsSettingsReport>(`/api/inverter/profiles/${profileId}/bms/${bmsId}/settings`);
        if (!cancelled) setLoaded({ key: `${profileId}/${bmsId}`, report: data });
      } catch {
        // 404: none yet; other failures: shown as none too.
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [profileId, bmsId]);

  return bmsId !== null && loaded?.key === key ? loaded.report : null;
}
