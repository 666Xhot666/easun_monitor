import type { BmsReading } from '../bms/reading';
import { IngestClient } from './ingest-client';

const reading = (at: number, soc = 50) =>
  ({
    timestamp: new Date(at).toISOString(),
    stateOfChargePct: soc,
  }) as BmsReading;

type Reply = number | 'network';

function client(replies: () => Reply, maxQueue = 60) {
  const posted: {
    url: string;
    auth: string;
    body: { timestamp: string; stateOfChargePct: number };
  }[] = [];
  const events: string[] = [];
  const fetchFn = jest.fn(async (url: string, init: RequestInit) => {
    const reply = replies();
    if (reply === 'network') throw new TypeError('fetch failed');
    if (reply < 300) {
      posted.push({
        url,
        auth: (init.headers as Record<string, string>).Authorization,
        body: JSON.parse(init.body as string),
      });
    }
    return new Response(null, { status: reply });
  });
  const ingest = new IngestClient({
    url: 'http://server:3000/api/bms/ingest',
    token: 'secret-token',
    fetch: fetchFn as unknown as typeof fetch,
    minIntervalMs: 5_000,
    maxQueue,
    onEvent: (e) => events.push(e),
  });
  return { ingest, posted, events, fetchFn };
}

describe('IngestClient', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('posts readings with the device token, at most one per interval', async () => {
    const { ingest, posted } = client(() => 201);

    for (let s = 0; s < 12; s++) ingest.offer(reading(s * 1000, s));
    await jest.advanceTimersByTimeAsync(0);

    expect(posted.map((p) => p.body.stateOfChargePct)).toEqual([0, 5, 10]);
    expect(posted[0]).toMatchObject({
      url: 'http://server:3000/api/bms/ingest',
      auth: 'Bearer secret-token',
    });
  });

  it('keeps readings while the server is down and sends them in order when it is back', async () => {
    let down = true;
    const { ingest, posted, events } = client(() => (down ? 'network' : 201));

    for (let s = 0; s < 3; s++) ingest.offer(reading(s * 5000, s));
    await jest.advanceTimersByTimeAsync(10_000);
    expect(posted).toEqual([]);
    expect(events[0]).toMatch(/fetch failed.*retrying in 1 s/);

    down = false;
    await jest.advanceTimersByTimeAsync(30_000);
    expect(posted.map((p) => p.body.stateOfChargePct)).toEqual([0, 1, 2]);
  });

  it('never buffers more than the queue holds, dropping the oldest', async () => {
    let down = true;
    const { ingest, posted } = client(() => (down ? 503 : 201), 3);

    for (let s = 0; s < 6; s++) ingest.offer(reading(s * 5000, s));
    await jest.advanceTimersByTimeAsync(5_000);
    down = false;
    await jest.advanceTimersByTimeAsync(60_000);

    // 0, 1 and 2 were pushed out by 3, 4 and 5 while the server was down.
    expect(posted.map((p) => p.body.stateOfChargePct)).toEqual([3, 4, 5]);
  });

  it('drops a reading the server rejects, and treats a duplicate as delivered', async () => {
    const replies: Reply[] = [400, 409, 201];
    const { ingest, posted, events, fetchFn } = client(
      () => replies.shift() ?? 201,
    );

    for (let s = 0; s < 3; s++) ingest.offer(reading(s * 5000, s));
    await jest.advanceTimersByTimeAsync(0);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(posted.map((p) => p.body.stateOfChargePct)).toEqual([2]);
    expect(events).toEqual([expect.stringMatching(/rejected.*400/)]);
  });
});
