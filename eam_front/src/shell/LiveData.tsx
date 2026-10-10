import { createContext, useContext, type ReactNode } from 'react';
import type { InverterProfile } from '../auth/types';
import { useDeviceStatus, type DeviceStatus } from '../inverter/useDeviceStatus';
import { DEFAULT_POLL_MS, useReading, type ReadingStatus } from '../inverter/useReading';
import { useRegisters } from '../inverter/useRegisters';
import type { LatestReading, RegisterDefinition } from '../inverter/types';
import { deriveSystemState, readingInFault, type SystemState } from './systemState';

export interface LiveData {
  profile: InverterProfile;
  /** The household role on this inverter: readers change nothing. */
  isAdmin: boolean;
  reading: LatestReading | null;
  readingStatus: ReadingStatus;
  deviceStatus: DeviceStatus | null;
  registers: RegisterDefinition[] | null;
  systemState: SystemState;
  pollMs: number;
}

const LiveDataContext = createContext<LiveData | null>(null);

/** Polls one inverter once for every page of the shell. */
export function LiveDataProvider({ profile, children }: { profile: InverterProfile; children: ReactNode }) {
  const { reading, status } = useReading(profile.id);
  const deviceStatus = useDeviceStatus(profile.id);
  const registers = useRegisters();
  const systemState = deriveSystemState({
    readingStatus: status,
    deviceStatus,
    inFault: readingInFault(reading, registers),
  });
  const value: LiveData = {
    profile,
    isAdmin: profile.role === 'ADMIN',
    reading,
    readingStatus: status,
    deviceStatus,
    registers,
    systemState,
    pollMs: DEFAULT_POLL_MS,
  };
  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLiveData(): LiveData {
  const value = useContext(LiveDataContext);
  if (!value) throw new Error('useLiveData must be used inside <LiveDataProvider>');
  return value;
}
