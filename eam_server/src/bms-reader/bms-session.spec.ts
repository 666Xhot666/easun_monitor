import { CELL_INFO, DEVICE_INFO, buildRequest } from '../bms/jk/requests';
import { referenceFrame } from '../bms/jk/testing/reference-frames';
import type { BmsReading } from '../bms/reading';
import { BmsSession, type SessionEvent } from './bms-session';
import type { BleConnection } from './noble-connection';

class FakeConnection implements BleConnection {
  id = 'c0ffee';
  name = 'JK-B2A8S20P';
  writes: Buffer[] = [];
  closed = false;
  private data: (chunk: Buffer) => void = () => {};
  private drop: (reason: string) => void = () => {};
  subscribe() {
    return Promise.resolve();
  }
  onData(listener: (chunk: Buffer) => void) {
    this.data = listener;
  }
  onDisconnect(listener: (reason: string) => void) {
    this.drop = listener;
  }
  write(frame: Buffer) {
    this.writes.push(frame);
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  /** Delivers bytes in BLE-sized chunks. */
  notify(bytes: Buffer) {
    for (let at = 0; at < bytes.length; at += 128)
      this.data(bytes.subarray(at, at + 128));
  }
  disconnect(reason: string) {
    this.drop(reason);
  }
}

const NOW = Date.parse('2026-10-06T12:00:00Z');

function startSession(protocol: 'JK02_32S' | 'JK02_24S' = 'JK02_32S') {
  const connection = new FakeConnection();
  const readings: BmsReading[] = [];
  const events: SessionEvent[] = [];
  const session = new BmsSession(connection, {
    protocol,
    source: 'mac-ble',
    now: () => Date.now(),
    onReading: (reading) => readings.push(reading),
    onEvent: (event) => events.push(event),
  });
  const ended = session.run();
  return { connection, readings, events, ended };
}

describe('BmsSession', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it('asks for device info, then cell info, once subscribed', async () => {
    const { connection } = startSession();
    await jest.advanceTimersByTimeAsync(0);

    expect(connection.writes).toEqual([
      buildRequest(DEVICE_INFO),
      buildRequest(CELL_INFO),
    ]);
  });

  it('turns cell-info frames into normalized readings', async () => {
    const { connection, readings, events } = startSession();
    await jest.advanceTimersByTimeAsync(0);

    connection.notify(referenceFrame('CELL_INFO_JK02_32S_V19'));

    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({
      timestamp: new Date(NOW).toISOString(),
      source: 'mac-ble',
      protocol: 'JK02_32S',
      decoderVersion: expect.stringMatching(/^jk-ble\//),
      stateOfChargePct: 100,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'frame',
        frameType: 2,
        hex: referenceFrame('CELL_INFO_JK02_32S_V19').toString('hex'),
      }),
    );
  });

  it('reports the device info, and warns when its software suggests another variant', async () => {
    const { connection, events } = startSession('JK02_32S');
    await jest.advanceTimersByTimeAsync(0);

    connection.notify(referenceFrame('DEVICE_INFO_JK02_24S_V10'));

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'device-info',
        detail: expect.stringContaining('JK-B2A24S20P'),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'variant-warning',
        detail: expect.stringMatching(/10\.07.*JK02_24S.*JK02_32S/),
      }),
    );
  });

  it('records checksum failures without stopping', async () => {
    const { connection, readings, events } = startSession();
    await jest.advanceTimersByTimeAsync(0);
    const corrupt = Buffer.from(referenceFrame('CELL_INFO_JK02_32S_V11'));
    corrupt[100] ^= 1;

    connection.notify(corrupt);
    connection.notify(referenceFrame('CELL_INFO_JK02_32S_V11'));

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'frame-error',
        detail: expect.stringMatching(/checksum/i),
      }),
    );
    expect(readings).toHaveLength(1);
  });

  it('asks again after 30 s without a frame, then gives up and closes', async () => {
    const { connection, events, ended } = startSession();
    await jest.advanceTimersByTimeAsync(0);
    connection.writes.length = 0;

    await jest.advanceTimersByTimeAsync(31_000);
    expect(connection.writes).toEqual([buildRequest(CELL_INFO)]);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'watchdog-resend' }),
    );

    await jest.advanceTimersByTimeAsync(31_000);
    await expect(ended).resolves.toMatch(/no frame/i);
    expect(connection.closed).toBe(true);
  });

  it('keeps going while frames arrive', async () => {
    const { connection } = startSession();
    await jest.advanceTimersByTimeAsync(0);
    connection.writes.length = 0;

    for (let i = 0; i < 10; i++) {
      await jest.advanceTimersByTimeAsync(20_000);
      connection.notify(referenceFrame('CELL_INFO_JK02_32S_V11'));
    }

    expect(connection.writes).toEqual([]);
    expect(connection.closed).toBe(false);
  });

  it('ends when the BMS disconnects', async () => {
    const { connection, ended } = startSession();
    await jest.advanceTimersByTimeAsync(0);

    connection.disconnect('out of range');

    await expect(ended).resolves.toMatch(/out of range/);
  });
});
