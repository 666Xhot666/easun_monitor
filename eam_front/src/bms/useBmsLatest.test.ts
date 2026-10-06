import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import { useBmsLatest } from './useBmsLatest';

const T0 = Date.parse('2026-10-06T12:00:00Z');
const latest = (timestamp: number) => ({
  status: 200,
  data: { reading: { timestamp: new Date(timestamp).toISOString(), stateOfChargePct: 90 }, ageSeconds: 1, status: 'live' },
});

describe('useBmsLatest', () => {
  let restore = () => {};
  afterEach(() => {
    restore();
    vi.useRealTimers();
  });

  it("fetches the device's latest reading", async () => {
    const server = fakeServer(() => latest(Date.now() - 1000));
    restore = server.restore;

    const { result } = renderHook(() => useBmsLatest(7, 3, { pollMs: 0 }));

    await waitFor(() => expect(result.current?.status).toBe('live'));
    expect(server.sent[0].url).toBe('/api/inverter/profiles/7/bms/3/latest');
  });

  it('is null when there is no device or no reading yet', async () => {
    restore = fakeServer(() => ({ status: 404 })).restore;

    const { result } = renderHook(() => useBmsLatest(7, 3, { pollMs: 0 }));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBeNull();

    const none = renderHook(() => useBmsLatest(7, null, { pollMs: 0 }));
    expect(none.result.current).toBeNull();
  });

  it('turns a reading stale on the clock, even when the server stops answering', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(T0);
    let up = true;
    restore = fakeServer(() => (up ? latest(T0 - 1000) : { status: 500 })).restore;

    const { result } = renderHook(() => useBmsLatest(7, 3, { pollMs: 5_000 }));
    await waitFor(() => expect(result.current?.status).toBe('live'));

    up = false;
    await act(async () => {
      vi.advanceTimersByTime(40_000);
    });

    expect(result.current?.status).toBe('stale');
    expect(result.current?.ageSeconds).toBeGreaterThanOrEqual(40);
  });
});
