import { RegisterMap, RegisterValueError, type RegisterDefinition } from '../registers/register-map';
import { InMemoryLogger } from './in-memory-logger';
import { LoggerLink, LoggerUnavailableError } from './logger-link';
import { TransportError, type LoggerTransport } from './logger-transport';

const defs: RegisterDefinition[] = [
  { name: 'Mode', label: 'Mode', address: 201, type: 'uint16', group: 'telemetry', options: ['A', 'B', 'C'] },
  { name: 'MainsVoltage', label: 'Mains voltage', address: 202, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'BatteryCurrent', label: 'Battery current', address: 204, type: 'int16', scale: 0.1, unit: 'A', group: 'telemetry' },
  { name: 'FaultCode', label: 'Fault code', address: 100, type: 'uint32', group: 'status' },
  { name: 'OutputVoltageSet', label: 'Output voltage', address: 320, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true, min: 200, max: 240 },
  { name: 'Priority', label: 'Priority', address: 321, type: 'uint16', group: 'settings', writable: true, options: ['UTI', 'SOL', 'SBU'] },
  { name: 'ExitFaultMode', label: 'Exit fault mode', address: 426, type: 'uint16', group: 'command', writable: true, choices: [1] },
];
const map = new RegisterMap(defs);

/** Transport adapter over an in-memory logger, with failure injection and
 * a check that requests never overlap. */
class FakeTransport implements LoggerTransport {
  connected = false;
  connects = 0;
  exchanges: Buffer[] = [];
  failConnect = false;
  /** Fail the Nth exchange from now (1 = next). */
  failExchangeAt = 0;
  private inFlight = 0;

  constructor(readonly logger: InMemoryLogger) {}

  async connect(): Promise<void> {
    this.connects++;
    if (this.failConnect) throw new TransportError('UDP handshake timed out');
    this.connected = true;
  }

  async exchange(frame: Buffer): Promise<Buffer> {
    if (!this.connected) throw new Error('exchange before connect');
    if (++this.inFlight > 1) throw new Error('overlapping requests');
    try {
      await new Promise((r) => setTimeout(r, 1));
      this.exchanges.push(frame);
      if (this.failExchangeAt > 0 && --this.failExchangeAt === 0) {
        this.connected = false;
        throw new TransportError('Timed out waiting for the logger');
      }
      return this.logger.handle(frame);
    } finally {
      this.inFlight--;
    }
  }

  close(): void {
    this.connected = false;
  }
}

function setup() {
  const logger = new InMemoryLogger({ isWritable: (address) => address >= 300 });
  logger.set(201, [1, 2305, 0, 0x10000 - 123]);
  logger.set(100, [0, 4]);
  logger.set(320, [2300, 2]);
  const transport = new FakeTransport(logger);
  let clock = 1_000_000;
  const link = new LoggerLink({
    transport,
    registers: map,
    backoff: { initialMs: 1000, maxMs: 8000 },
    now: () => clock,
  });
  return { logger, transport, link, advance: (ms: number) => (clock += ms), now: () => clock };
}

describe('LoggerLink reads', () => {
  it('reads each group in as few requests as its blocks allow', async () => {
    const { link, transport } = setup();
    const reading = await link.read(['telemetry', 'status']);

    expect(reading).toEqual({ Mode: 1, MainsVoltage: 230.5, BatteryCurrent: -12.3, FaultCode: 4 });
    expect(transport.exchanges).toHaveLength(2);
    expect(transport.connects).toBe(1);
  });

  it('never sends overlapping requests, even for concurrent callers', async () => {
    const { link } = setup();
    await expect(
      Promise.all([
        link.read(['telemetry']),
        link.read(['status']),
        link.write({ OutputVoltageSet: 230 }),
        link.read(['settings']),
      ]),
    ).resolves.toHaveLength(4);
  });

  it('keeps the rest of a reading when the logger rejects one block', async () => {
    const { link, logger } = setup();
    logger.rejectReadsAt(100, 2);
    await expect(link.read(['telemetry', 'status'])).resolves.toEqual({
      Mode: 1,
      MainsVoltage: 230.5,
      BatteryCurrent: -12.3,
    });
  });
});

describe('LoggerLink failures and backoff', () => {
  it('aborts the cycle on the first link failure and backs off', async () => {
    const { link, transport, now } = setup();
    transport.failExchangeAt = 1;

    await expect(link.read(['telemetry', 'status'])).rejects.toThrow(LoggerUnavailableError);
    expect(transport.exchanges).toHaveLength(1);
    expect(link.status()).toMatchObject({
      state: 'backoff',
      retryAt: now() + 1000,
      lastError: 'Timed out waiting for the logger',
    });
  });

  it('does not touch the transport while backing off, then reconnects', async () => {
    const { link, transport, advance } = setup();
    transport.failConnect = true;
    await expect(link.read(['telemetry'])).rejects.toThrow(LoggerUnavailableError);
    expect(transport.connects).toBe(1);

    await expect(link.read(['telemetry'])).rejects.toThrow(/retrying in 1s/);
    expect(transport.connects).toBe(1);

    transport.failConnect = false;
    advance(1000);
    await expect(link.read(['telemetry'])).resolves.toMatchObject({ Mode: 1 });
    expect(transport.connects).toBe(2);
    expect(link.status()).toMatchObject({ state: 'online', lastError: null });
  });

  it('doubles the backoff up to the maximum and resets it on success', async () => {
    const { link, transport, advance, now } = setup();
    transport.failConnect = true;
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      await link.read(['telemetry']).catch(() => {});
      const { retryAt } = link.status();
      delays.push(retryAt! - now());
      advance(retryAt! - now());
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]);

    transport.failConnect = false;
    await link.read(['telemetry']);
    transport.failExchangeAt = 1;
    await link.read(['telemetry']).catch(() => {});
    expect(link.status().retryAt! - now()).toBe(1000);
  });

  it('records when it last read successfully', async () => {
    const { link, now } = setup();
    expect(link.status()).toMatchObject({ state: 'offline', lastSuccessAt: null });
    await link.read(['telemetry']);
    expect(link.status()).toMatchObject({ state: 'online', lastSuccessAt: now() });
  });
});

describe('LoggerLink writes', () => {
  it('writes a setting and returns the value read back from the device', async () => {
    const { link, logger } = setup();
    await expect(link.write({ OutputVoltageSet: 220.5, Priority: 1 })).resolves.toEqual({
      OutputVoltageSet: 220.5,
      Priority: 1,
    });
    expect(logger.get(320, 2)).toEqual([2205, 1]);
  });

  it('validates values before sending anything', async () => {
    const { link, transport } = setup();
    await expect(link.write({ OutputVoltageSet: 300 })).rejects.toThrow(RegisterValueError);
    await expect(link.write({ MainsVoltage: 230 })).rejects.toThrow(/not writable/);
    expect(transport.exchanges).toHaveLength(0);
  });

  it('reports a write the device rejects', async () => {
    const { link, logger } = setup();
    logger.rejectWritesAt(321, 7);
    await expect(link.write({ Priority: 2 })).rejects.toThrow(/not allowed to be modified/);
  });
});

describe('LoggerLink commands', () => {
  it('sends a write-only command without reading it back', async () => {
    const { link, logger, transport } = setup();
    await link.command('ExitFaultMode', 1);
    expect(logger.get(426, 1)).toEqual([1]);
    expect(transport.exchanges).toHaveLength(1);
  });

  it('validates the command before sending it', async () => {
    const { link, transport } = setup();
    await expect(link.command('ExitFaultMode', 2)).rejects.toThrow(RegisterValueError);
    expect(transport.exchanges).toHaveLength(0);
  });

  it('keeps commands out of group reads', () => {
    expect(map.list().filter((d) => d.group !== 'command')).toHaveLength(defs.length - 1);
    expect(map.blocks('settings').some((b) => b.address + b.count > 426)).toBe(false);
  });
});

describe('LoggerLink probe', () => {
  it('does a full round trip and reports latency', async () => {
    const { link, transport } = setup();
    const result = await link.probe();
    expect(result).toEqual({ latencyMs: expect.any(Number), sampledRegister: 'Mode' });
    expect(transport.exchanges).toHaveLength(1);
  });
});
