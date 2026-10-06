import { reconnectLoop } from './reconnect-loop';

describe('reconnectLoop', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries failed connects after 1 s, doubling up to 30 s', async () => {
    const attempts: number[] = [];
    const stop = new AbortController();
    const done = reconnectLoop({
      connect: () => {
        attempts.push(Date.now());
        return Promise.reject(new Error('not found'));
      },
      session: () => Promise.resolve('unused'),
      onEvent: () => {},
      signal: stop.signal,
    });

    await jest.advanceTimersByTimeAsync(200_000);
    stop.abort();
    await jest.advanceTimersByTimeAsync(30_000);
    await done;

    const gaps = attempts.slice(1).map((t, i) => t - attempts[i]);
    expect(gaps.slice(0, 7)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it('starts again from 1 s after a connection that stayed up', async () => {
    const attempts: number[] = [];
    let call = 0;
    const stop = new AbortController();
    const done = reconnectLoop({
      connect: () => {
        attempts.push(Date.now());
        call++;
        return call === 4
          ? Promise.resolve('link')
          : Promise.reject(new Error('busy'));
      },
      // The one good connection lasts a minute, then drops.
      session: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve('Disconnected: out of range'), 60_000),
        ),
      onEvent: () => {},
      signal: stop.signal,
    });

    await jest.advanceTimersByTimeAsync(100_000);
    stop.abort();
    await jest.advanceTimersByTimeAsync(30_000);
    await done;

    const gaps = attempts.slice(1).map((t, i) => t - attempts[i]);
    // 1 s, 2 s, 4 s; then the 60 s session and 1 s after it drops; then doubling again.
    expect(gaps.slice(0, 5)).toEqual([1000, 2000, 4000, 61_000, 2000]);
  });

  it('reports why each attempt ended', async () => {
    const events: string[] = [];
    const stop = new AbortController();
    const done = reconnectLoop({
      connect: () => Promise.reject(new Error('Bluetooth is off')),
      session: () => Promise.resolve(''),
      onEvent: (e) => events.push(e),
      signal: stop.signal,
    });
    await jest.advanceTimersByTimeAsync(1500);
    stop.abort();
    await jest.advanceTimersByTimeAsync(30_000);
    await done;

    expect(events[0]).toMatch(/Bluetooth is off.*retrying in 1 s/);
  });
});
