import { describe, expect, it } from 'vitest';
import type { DeviceStatus } from '../inverter/useDeviceStatus';
import { deriveSystemState } from './systemState';

const device = (state: DeviceStatus['state']): DeviceStatus => ({
  state,
  lastSuccessAt: null,
  lastError: null,
  retryAt: null,
});

describe('deriveSystemState', () => {
  it('is loading until the first answer', () => {
    expect(deriveSystemState({ readingStatus: 'loading', deviceStatus: null, inFault: false })).toBe('loading');
  });

  it('waits for the first reading of a new inverter', () => {
    expect(deriveSystemState({ readingStatus: 'no-data', deviceStatus: device('offline'), inFault: false })).toBe('waiting');
  });

  it('is live with a recent reading', () => {
    expect(deriveSystemState({ readingStatus: 'live', deviceStatus: device('online'), inFault: false })).toBe('live');
  });

  it('puts a fault above everything else while readings are recent', () => {
    expect(deriveSystemState({ readingStatus: 'live', deviceStatus: device('online'), inFault: true })).toBe('fault');
  });

  it('is stale when the logger answers but the readings stopped', () => {
    expect(deriveSystemState({ readingStatus: 'stale', deviceStatus: device('online'), inFault: false })).toBe('stale');
  });

  it('is offline when the logger cannot be reached', () => {
    expect(deriveSystemState({ readingStatus: 'stale', deviceStatus: device('backoff'), inFault: false })).toBe('offline');
    expect(deriveSystemState({ readingStatus: 'live', deviceStatus: device('backoff'), inFault: false })).toBe('offline');
  });

  it('is offline when the app cannot reach the server', () => {
    expect(deriveSystemState({ readingStatus: 'unreachable', deviceStatus: null, inFault: false })).toBe('offline');
  });

  it('does not claim a fault from an old reading', () => {
    expect(deriveSystemState({ readingStatus: 'stale', deviceStatus: device('online'), inFault: true })).toBe('stale');
  });
});
