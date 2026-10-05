import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaptureStore } from './capture-store';
import { SerialCapture, type SerialTap } from './serial-capture';

const bytes = (hex: string) => Buffer.from(hex.replace(/ /g, ''), 'hex');
const READ_301 = '01 03 01 2d 00 01 15 ff'; // request: read register 301
const VALUE_2 = '01 03 02 00 02 39 85'; // response: one register = 2
const WRITE_301 = '01 10 01 2d 00 01 02 00 02 31 2c';

class FakeTap implements SerialTap {
  closed = false;
  private data: (chunk: Buffer) => void = () => {};
  private error: (error: Error) => void = () => {};
  onData(listener: (chunk: Buffer) => void) {
    this.data = listener;
  }
  onError(listener: (error: Error) => void) {
    this.error = listener;
  }
  async close() {
    this.closed = true;
  }
  receive(hex: string) {
    this.data(bytes(hex));
  }
  fail(message: string) {
    this.error(new Error(message));
  }
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => jest.requireActual<typeof import('timers')>('timers').setImmediate(resolve));

describe('SerialCapture', () => {
  let dir: string;
  let opened: { path: string; baudRate: number; tap: FakeTap }[];
  let failNextOpens: number;
  let capture: SerialCapture;
  let store: CaptureStore;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-03T12:00:00.000Z') });
    dir = mkdtempSync(join(tmpdir(), 'capture-'));
    opened = [];
    failNextOpens = 0;
    store = new CaptureStore(dir);
    capture = new SerialCapture({
      store,
      windowMs: 1000,
      openTap: async (path, baudRate) => {
        if (failNextOpens > 0) {
          failNextOpens--;
          throw new Error(`cannot open ${path}`);
        }
        const tap = new FakeTap();
        opened.push({ path, baudRate, tap });
        return tap;
      },
    });
  });

  afterEach(async () => {
    await capture.stop();
    jest.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  const tap = (path: string) => [...opened].reverse().find((o) => o.path === path)!.tap;
  const start = () => capture.start({ rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx', rxBaud: 9600, txBaud: 115200 });
  const pairs = () => capture.records(0).filter((r) => r.kind === 'pair');

  it('opens both taps at their own baud rates and pairs what they hear', async () => {
    await start();
    expect(opened.map(({ path, baudRate }) => [path, baudRate])).toEqual([
      ['/dev/cu.rx', 9600],
      ['/dev/cu.tx', 115200],
    ]);

    tap('/dev/cu.tx').receive(READ_301);
    tap('/dev/cu.rx').receive(VALUE_2);

    expect(pairs()).toEqual([
      expect.objectContaining({ seq: 3, kind: 'pair', request: expect.objectContaining({ address: 301 }), response: expect.objectContaining({ words: [2] }) }),
    ]);
    const { meta, records } = store.read(capture.status().captureId!)!;
    expect(meta).toMatchObject({ rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx' });
    expect(records.map((r) => r.kind)).toEqual(['port', 'port', 'pair']);
  });

  it('hands every record to a listener as it is captured', async () => {
    const seen: string[] = [];
    const listening = new SerialCapture({
      store,
      windowMs: 1000,
      openTap: async (path, baudRate) => {
        const tap = new FakeTap();
        opened.push({ path, baudRate, tap });
        return tap;
      },
      onRecord: (record) => seen.push(record.kind),
    });
    await listening.start({ rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx', rxBaud: 9600, txBaud: 9600 });
    tap('/dev/cu.tx').receive(READ_301);
    tap('/dev/cu.rx').receive(VALUE_2);
    await listening.stop();
    expect(seen).toEqual(['port', 'port', 'pair']);
  });

  it('records a request left unanswered once the window has passed', async () => {
    await start();
    tap('/dev/cu.tx').receive(READ_301);
    jest.advanceTimersByTime(1600);
    expect(capture.records(0).filter((r) => r.kind === 'unanswered')).toHaveLength(1);
  });

  it('counts write requests it skips', async () => {
    await start();
    tap('/dev/cu.tx').receive(WRITE_301);
    expect(capture.status().skippedWrites).toBe(1);
  });

  it('reopens a port that fails, backing off, and records the outage', async () => {
    await start();
    failNextOpens = 1;
    tap('/dev/cu.tx').fail('device reports readiness to read but returned no data');
    expect(capture.status().ports.tx!).toMatchObject({ state: 'reconnecting', error: 'device reports readiness to read but returned no data' });
    expect(capture.status().ports.rx!.state).toBe('open');

    jest.advanceTimersByTime(1000); // first retry fails
    await settle();
    expect(capture.status().ports.tx!.state).toBe('reconnecting');
    jest.advanceTimersByTime(1999);
    await settle();
    expect(capture.status().ports.tx!.state).toBe('reconnecting');
    jest.advanceTimersByTime(1); // second retry, 2 s later, succeeds
    await settle();

    expect(capture.status().ports.tx!).toMatchObject({ state: 'open', error: null, reconnects: 1 });
    tap('/dev/cu.tx').receive(READ_301);
    tap('/dev/cu.rx').receive(VALUE_2);
    expect(pairs()).toHaveLength(1);
    expect(capture.records(0).filter((r) => r.kind === 'port').map((r) => r.kind === 'port' && `${r.port}:${r.state}`)).toEqual([
      'rx:open', 'tx:open', 'tx:reconnecting', 'tx:open',
    ]);
  });

  it('keeps retrying a port that cannot be opened at start', async () => {
    failNextOpens = 1;
    await start();
    expect(capture.status().ports.rx!.state).toBe('reconnecting');
    jest.advanceTimersByTime(1000);
    await settle();
    expect(capture.status().ports.rx!.state).toBe('open');
  });

  it('stops: closes both taps, settles what is pending, and stops retrying', async () => {
    await start();
    tap('/dev/cu.tx').receive(READ_301);
    await capture.stop();

    expect(opened.every((o) => o.tap.closed)).toBe(true);
    expect(capture.status()).toMatchObject({ running: false });
    expect(capture.records(0).some((r) => r.kind === 'unanswered')).toBe(true);
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(opened).toHaveLength(2);
  });
});
