import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import { describeDeviceStatus, useDeviceStatus } from './useDeviceStatus';

describe('useDeviceStatus', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('fetches the logger status for a profile', async () => {
    const server = fakeServer(() => ({
      status: 200,
      data: { state: 'online', lastSuccessAt: '2026-09-30T11:59:58Z', lastError: null, retryAt: null },
    }));
    restore = server.restore;

    const { result } = renderHook(() => useDeviceStatus(3, 0));
    await waitFor(() => expect(result.current?.state).toBe('online'));
    expect(server.sent[0].url).toBe('/api/inverter/3/status');
  });
});

describe('describeDeviceStatus', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');

  it('says nothing while the logger is online', () => {
    expect(
      describeDeviceStatus({ state: 'online', lastSuccessAt: '2026-09-30T11:59:58Z', lastError: null, retryAt: null }, now),
    ).toBeNull();
  });

  it('explains a backoff with the error and the retry time', () => {
    expect(
      describeDeviceStatus(
        { state: 'backoff', lastSuccessAt: null, lastError: 'UDP handshake timed out', retryAt: '2026-09-30T12:00:40Z' },
        now,
      ),
    ).toBe('Inverter logger unreachable (UDP handshake timed out). Retrying in 40 s.');
  });

  it('mentions an offline logger that has never answered', () => {
    expect(
      describeDeviceStatus({ state: 'offline', lastSuccessAt: null, lastError: null, retryAt: null }, now),
    ).toBe('Waiting for the first contact with the inverter logger.');
  });
});
