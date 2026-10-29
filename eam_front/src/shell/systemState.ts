import type { DeviceStatus } from '../inverter/useDeviceStatus';
import type { ReadingStatus } from '../inverter/useReading';
import type { LatestReading } from '../inverter/types';

/**
 * One word for the whole system, shown by the status pill and banner on
 * every page.
 *
 * loading: first request in flight. waiting: a new inverter, no reading yet.
 * live: recent readings. fault: the inverter is in fault mode (recent reading).
 * stale: the logger answers but readings stopped. offline: the logger, or the
 * server itself, cannot be reached.
 */
export type SystemState = 'loading' | 'waiting' | 'live' | 'fault' | 'stale' | 'offline';

export function deriveSystemState({
  readingStatus,
  deviceStatus,
  inFault,
}: {
  readingStatus: ReadingStatus;
  deviceStatus: DeviceStatus | null;
  inFault: boolean;
}): SystemState {
  if (readingStatus === 'loading') return 'loading';
  if (readingStatus === 'no-data') return 'waiting';
  if (readingStatus === 'unreachable') return 'offline';
  if (deviceStatus && deviceStatus.state !== 'online') return 'offline';
  if (readingStatus === 'stale') return 'stale';
  return inFault ? 'fault' : 'live';
}

/** Whether a reading says the inverter is in fault mode. */
export function readingInFault(reading: LatestReading | null): boolean {
  return reading?.readings.state === 'fault';
}
