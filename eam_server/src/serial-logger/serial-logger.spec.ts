import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoggerLink } from '../inverter/link/logger-link';
import type { LoggerTransport } from '../inverter/link/logger-transport';
import { crc16 } from '../inverter/protocol/logger-frame';
import { RegisterMap } from '../inverter/registers/register-map';
import { SMG_II_REGISTERS } from '../inverter/registers/smg-ii.registers';
import { CaptureStore } from '../inverter/serial-sniff/capture-store';
import type { SerialTap } from '../inverter/serial-sniff/serial-capture';
import { FRESH_MS } from './constants';
import { EspLink, type DuplexPort } from './esp-link';
import { createEspSerialLogger, createSerialLogger } from './serial-logger';

class FakeTap implements SerialTap {
  private data: (chunk: Buffer) => void = () => {};
  onData(listener: (chunk: Buffer) => void) {
    this.data = listener;
  }
  onError() {}
  async close() {}
  receive(bytes: Buffer) {
    this.data(bytes);
  }
}

const withCrc = (bytes: number[]) => Buffer.concat([Buffer.from(bytes), crc16(Buffer.from(bytes))]);
const readRequest = (address: number, quantity: number) =>
  withCrc([1, 3, address >> 8, address & 0xff, quantity >> 8, quantity & 0xff]);
const readResponse = (words: number[]) =>
  withCrc([1, 3, words.length * 2, ...words.flatMap((w) => [w >> 8, w & 0xff])]);

describe('Serial logger', () => {
  const map = new RegisterMap(SMG_II_REGISTERS);
  let dir: string;
  let taps: Map<string, FakeTap>;
  let service: ReturnType<typeof createSerialLogger>;
  let link: LoggerLink;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'serial-logger-'));
    taps = new Map();
    service = createSerialLogger({
      store: new CaptureStore(dir),
      openTap: async (path) => {
        const tap = new FakeTap();
        taps.set(path, tap);
        return tap;
      },
    });
    await service.capture.start({ rxPath: 'rx', txPath: 'tx', rxBaud: 9600, txBaud: 9600 });
    // The main app's side: a Logger link whose transport is the emulated logger.
    const transport: LoggerTransport = {
      connected: true,
      connect: async () => {},
      exchange: async (frame) => service.logger.handle(frame),
      close: () => {},
    };
    link = new LoggerLink({ transport, registers: map });
  });

  afterEach(async () => {
    await service.capture.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  /** The real logger reads a block from the inverter; both taps hear it. */
  const overhear = (address: number, words: number[]) => {
    taps.get('tx')!.receive(readRequest(address, words.length));
    taps.get('rx')!.receive(readResponse(words));
  };

  it('has nothing to report before the logger has read anything', async () => {
    await expect(link.read(['telemetry'])).resolves.toEqual({});
  });

  it('serves what the logger last read from the inverter, decoded by the register map', async () => {
    const block = Array.from({ length: 22 }, () => 0);
    block[2] = 2305; // 202 MainsVoltage 230.5 V
    block[15] = 274; // 215 BatteryVoltage 27.4 V
    overhear(200, block);

    const reading = await link.read(['telemetry']);
    expect(reading).toMatchObject({ MainsVoltage: 230.5, BatteryVoltage: 27.4 });
    expect(reading).not.toHaveProperty('PVPower'); // 223x13 not read by the logger yet

    // Until the logger reads again, the same values keep being served.
    await expect(link.read(['telemetry'])).resolves.toMatchObject({ MainsVoltage: 230.5 });
    block[2] = 2201;
    overhear(200, block);
    await expect(link.read(['telemetry'])).resolves.toMatchObject({ MainsVoltage: 220.1 });
  });

  it('refuses writes: serial mode only listens', async () => {
    overhear(300, Array.from({ length: 12 }, () => 0));
    await expect(link.write({ OutputPriority: 1 })).rejects.toThrow(/Read-only register/);
  });

  it('keeps saving the capture for register discovery', async () => {
    overhear(200, Array.from({ length: 22 }, () => 0));
    const [capture] = new CaptureStore(dir).list();
    expect(new CaptureStore(dir).read(capture.id)!.records.some((r) => r.kind === 'pair')).toBe(true);
  });
});

/** The ESP's port; `inverter` answers our reads as the inverter would. */
class FakeEspPort implements DuplexPort {
  written: string[] = [];
  inverter: ((address: number, count: number) => Buffer | null) | null = null;
  private data: (chunk: Buffer) => void = () => {};
  onData(listener: (chunk: Buffer) => void) {
    this.data = listener;
  }
  onError() {}
  write(text: string) {
    this.written.push(text);
    const request = Buffer.from(text.trim(), 'hex');
    const reply = this.inverter?.(request.readUInt16BE(2), request.readUInt16BE(4));
    setImmediate(() => this.say(reply ? `I>D 1 ${reply.toString('hex')}\n` : '# timeout\n'));
  }
  async close() {}
  say(text: string) {
    this.data(Buffer.from(text));
  }
  /** Addresses of the reads sent through the proxy. */
  asked() {
    return this.written.map((line) => Buffer.from(line.trim(), 'hex').readUInt16BE(2));
  }
}

describe('Serial logger on the ESP proxy', () => {
  const map = new RegisterMap(SMG_II_REGISTERS);
  const hex = (bytes: Buffer) => bytes.toString('hex').toUpperCase();
  let dir: string;
  let port: FakeEspPort;
  let esp: EspLink;
  let service: ReturnType<typeof createEspSerialLogger>;
  let link: LoggerLink;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'serial-logger-'));
    port = new FakeEspPort();
    esp = new EspLink({ path: '/dev/esp', openPort: async () => port });
    await esp.start();
    service = createEspSerialLogger({ link: esp, store: new CaptureStore(dir) });
    await service.capture.start({ rxPath: 'rx', txPath: 'tx', rxBaud: 9600, txBaud: 9600 });
    // The main app's side, through the logger server's order: prepare, then answer.
    const transport: LoggerTransport = {
      connected: true,
      connect: async () => {},
      exchange: async (frame) => {
        await service.prepare(frame);
        return service.logger.handle(frame);
      },
      close: () => {},
    };
    link = new LoggerLink({ transport, registers: map });
  });

  afterEach(async () => {
    await service.capture.stop();
    await esp.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const wordsAt = (address: number, count: number, wordAt: (address: number) => number) =>
    readResponse(Array.from({ length: count }, (_, i) => wordAt(address + i)));

  it('reads what the app asks for through the proxy before answering, even registers the plug never reads', async () => {
    port.inverter = (address, count) => wordsAt(address, count, (a) => (a === 202 ? 2305 : a === 215 ? 274 : 0));
    await expect(link.read(['telemetry'])).resolves.toMatchObject({ MainsVoltage: 230.5, BatteryVoltage: 27.4 });
    expect(port.asked()).toContain(200);
  });

  it("answers from what the plug just read, without asking again", async () => {
    port.inverter = (address, count) => wordsAt(address, count, () => 0);
    const block = Array.from({ length: 22 }, () => 0);
    block[2] = 2201;
    port.say(`P>I 10 ${hex(readRequest(200, 22))}\nI>P 40 ${hex(readResponse(block))}\n`);

    await expect(link.read(['telemetry'])).resolves.toMatchObject({ MainsVoltage: 220.1 });
    expect(port.asked()).not.toContain(200);
  });

  it('answers from what was last heard when the inverter does not answer', async () => {
    const block = Array.from({ length: 22 }, () => 0);
    block[2] = 2201;
    port.say(`P>I 10 ${hex(readRequest(200, 22))}\nI>P 40 ${hex(readResponse(block))}\n`);
    const heardAt = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(heardAt + FRESH_MS); // no longer fresh
    port.inverter = () => null;
    try {
      await expect(link.read(['telemetry'])).resolves.toMatchObject({ MainsVoltage: 220.1 });
      expect(port.asked()).toContain(200);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it("passes on the inverter's refusal", async () => {
    port.inverter = (address) => (address === 200 ? withCrc([1, 0x83, 2]) : wordsAt(address, 13, () => 0));
    const reading = await link.read(['telemetry']);
    expect(reading).not.toHaveProperty('MainsVoltage');
  });

  it('still refuses writes', async () => {
    port.say(`P>I 10 ${hex(readRequest(300, 12))}\nI>P 40 ${hex(readResponse(Array.from({ length: 12 }, () => 0)))}\n`);
    await expect(link.write({ OutputPriority: 1 })).rejects.toThrow(/Read-only register/);
  });
});
