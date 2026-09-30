import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import { useReading } from './useReading';

const at = (iso: string) => ({ id: 1, timestamp: iso, payload: { PVPower: 1200 } });
const NOW = Date.parse('2026-09-30T12:00:00Z');
const now = () => NOW;

describe('useReading', () => {
  let restore = () => {};
  afterEach(() => restore());

  const serve = (handler: (url: string) => Reply) => {
    const server = fakeServer((config) => handler(config.url ?? ''));
    restore = server.restore;
    return server;
  };

  it('starts loading, then reports a fresh reading as live', async () => {
    serve(() => ({ status: 200, data: at('2026-09-30T11:59:58Z') }));
    const { result } = renderHook(() => useReading(3, { pollMs: 0, now }));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.reading?.payload.PVPower).toBe(1200);
  });

  it('reports stale when the newest reading is older than the threshold', async () => {
    serve(() => ({ status: 200, data: at('2026-09-30T11:55:00Z') }));
    const { result } = renderHook(() => useReading(3, { pollMs: 0, staleAfterMs: 60_000, now }));
    await waitFor(() => expect(result.current.status).toBe('stale'));
  });

  it('reports no-data when the server has no reading yet', async () => {
    serve(() => ({ status: 404 }));
    const { result } = renderHook(() => useReading(3, { pollMs: 0, now }));
    await waitFor(() => expect(result.current.status).toBe('no-data'));
    expect(result.current.reading).toBeNull();
  });

  it('keeps the last reading on screen when the server becomes unreachable', async () => {
    let up = true;
    serve(() => (up ? { status: 200, data: at('2026-09-30T11:59:58Z') } : { status: 502 }));
    const { result } = renderHook(() => useReading(3, { pollMs: 0, now }));
    await waitFor(() => expect(result.current.status).toBe('live'));

    up = false;
    await act(() => result.current.refresh());

    expect(result.current.status).toBe('unreachable');
    expect(result.current.reading?.payload.PVPower).toBe(1200);
  });

  it('polls on an interval', async () => {
    const server = serve(() => ({ status: 200, data: at('2026-09-30T11:59:58Z') }));
    renderHook(() => useReading(3, { pollMs: 20, now }));
    await waitFor(() => expect(server.sent.length).toBeGreaterThanOrEqual(3));
    expect(server.sent[0].url).toBe('/api/inverter/3/latest');
  });

  it('starts over when the profile changes', async () => {
    const server = serve((url) =>
      url.includes('/4/') ? { status: 404 } : { status: 200, data: at('2026-09-30T11:59:58Z') },
    );
    const { result, rerender } = renderHook(({ id }) => useReading(id, { pollMs: 0, now }), {
      initialProps: { id: 3 },
    });
    await waitFor(() => expect(result.current.status).toBe('live'));

    rerender({ id: 4 });
    await waitFor(() => expect(result.current.status).toBe('no-data'));
    expect(result.current.reading).toBeNull();
    expect(server.sent.at(-1)?.url).toBe('/api/inverter/4/latest');
  });
});
