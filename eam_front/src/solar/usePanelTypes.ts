import { useCallback, useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import type { PanelType } from './pvArray';

const fetchPanelTypes = async (): Promise<PanelType[]> =>
  (await axios.get<PanelType[]>('/api/panel-types')).data;

/** The user's panel types; null until loaded. `reload` fetches them again after a change. */
export function usePanelTypes() {
  const [panelTypes, setPanelTypes] = useState<PanelType[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setPanelTypes(await fetchPanelTypes());
    } catch {
      setPanelTypes((current) => current ?? []);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetchPanelTypes()
      .then((data) => {
        if (!cancelled) setPanelTypes(data);
      })
      .catch(() => {
        if (!cancelled) setPanelTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { panelTypes, reload };
}
