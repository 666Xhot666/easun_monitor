import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import type { RegisterDefinition } from './types';

// The register map only changes with a server release, so it is fetched
// once per page load and shared by every screen.
let cached: Promise<RegisterDefinition[]> | null = null;

function loadRegisters(): Promise<RegisterDefinition[]> {
  cached ??= axios
    .get<RegisterDefinition[]>('/api/inverter/registers')
    .then(({ data }) => data)
    .catch((error: unknown) => {
      cached = null;
      throw error;
    });
  return cached;
}

/** The server's Register map; null until loaded (or if loading failed). */
export function useRegisters(): RegisterDefinition[] | null {
  const [registers, setRegisters] = useState<RegisterDefinition[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadRegisters()
      .then((data) => {
        if (!cancelled) setRegisters(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return registers;
}
