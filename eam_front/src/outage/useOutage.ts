import { useCallback, useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import type { OutageForecast, OutageSource } from './types';

/** The inverter's outage source (null: none set, undefined: loading); `reload` fetches it again. */
export function useOutageSource(profileId: number) {
  const [source, setSource] = useState<OutageSource | null | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const { data } = await axios.get<{ source: OutageSource | null }>(`/api/inverter/profiles/${profileId}/outage-source`);
      setSource(data.source);
    } catch {
      setSource((current) => current ?? null);
    }
  }, [profileId]);

  useEffect(() => {
    if (profileId <= 0) return;
    let cancelled = false;
    axios
      .get<{ source: OutageSource | null }>(`/api/inverter/profiles/${profileId}/outage-source`)
      .then(({ data }) => {
        if (!cancelled) setSource(data.source);
      })
      .catch(() => {
        if (!cancelled) setSource(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  return { source, setSource, reload };
}

/**
 * The inverter's outage forecast, fetched again every `refreshMs`; null until
 * loaded or when it cannot be fetched. `reload` fetches it now.
 */
export function useOutageForecast(profileId: number, refreshMs = 300_000) {
  const [forecast, setForecast] = useState<OutageForecast | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (profileId <= 0) return;
    let cancelled = false;
    const load = () =>
      axios
        .get<OutageForecast>(`/api/inverter/profiles/${profileId}/outage-forecast`)
        .then(({ data }) => {
          if (!cancelled) setForecast(data);
        })
        .catch(() => {
          if (!cancelled) setForecast(null);
        });
    void load();
    const timer = setInterval(() => void load(), refreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [profileId, refreshMs, version]);

  return { forecast, reload };
}

/** The outage site's cities, as the reader last sent them; empty before its first run. */
export function useOutageCities() {
  const [cities, setCities] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<string[]>('/api/outage/cities')
      .then(({ data }) => {
        if (!cancelled) setCities(data);
      })
      .catch(() => {
        if (!cancelled) setCities([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return cities;
}

/** The streets of `city` on the outage site; empty when the city is not on its list (`known` false). */
export function useOutageStreets(city: string, known: boolean) {
  const [loaded, setLoaded] = useState<{ city: string; streets: string[] } | null>(null);

  useEffect(() => {
    if (!known) return;
    let cancelled = false;
    axios
      .get<string[]>('/api/outage/streets', { params: { city } })
      .then(({ data }) => {
        if (!cancelled) setLoaded({ city, streets: data });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ city, streets: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [city, known]);

  return known && loaded?.city === city ? loaded.streets : [];
}
