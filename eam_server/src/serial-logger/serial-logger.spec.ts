import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoggerLink } from '../inverter/link/logger-link';
import type { LoggerTransport } from '../inverter/link/logger-transport';
import { crc16, decodeReply, encodeRequest } from '../inverter/protocol/logger-frame';
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
  /** Answers each frame sent through the proxy: its address, count and the whole request. */
  inverter: ((address: number, count: number, request: Buffer) => Buffer | null) | null = null;
  private data: (chunk: Buffer) => void = () => {};
  onData(listener: (chunk: Buffer) => void) {
    this.data = listener;
  }
  onError() {}
  write(text: string) {
    this.written.push(text);
    const request = Buffer.from(text.trim(), 'hex');
    const reply = this.inverter?.(request.readUInt16BE(2), request.readUInt16BE(4), request);
    setImmediate(() => this.say(reply ? `I>D 1 ${reply.toString('hex')}\n` : '# timeout\n'));
  }
  async close() {}
  say(text: string) {
    this.data(Buffer.from(text));
  }
  /** Addresses of the reads sent through the proxy. */
  asked() {
    return this.frames().filter((f) => f[1] === 0x03).map((f) => f.readUInt16BE(2));
  }
  /** Addresses of the writes sent through the proxy. */
  wrote() {
    return this.frames().filter((f) => f[1] === 0x10).map((f) => f.readUInt16BE(2));
  }
  private frames() {
    return this.written.map((line) => Buffer.from(line.trim(), 'hex'));
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
  let logged: string[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'serial-logger-'));
    port = new FakeEspPort();
    esp = new EspLink({ path: '/dev/esp', openPort: async () => port });
    await esp.start();
    logged = [];
    service = createEspSerialLogger({ link: esp, store: new CaptureStore(dir), log: (m) => logged.push(m) });
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

  /** A fake inverter holding registers: reads answer them, writes change them. */
  const inverterWith = (registers: Map<number, number>) => (address: number, count: number, request: Buffer) => {
    if (request[1] !== 0x10) return wordsAt(address, count, (a) => registers.get(a) ?? 0);
    for (let i = 0; i < count; i++) registers.set(address + i, request.readUInt16BE(7 + i * 2));
    return withCrc([1, 0x10, address >> 8, address & 0xff, count >> 8, count & 0xff]);
  };

  it("writes a setting through the proxy, and confirms it from the inverter's own reading", async () => {
    const registers = new Map([[301, 0]]);
    port.inverter = inverterWith(registers);

    await expect(link.write({ OutputPriority: 2 })).resolves.toEqual({ OutputPriority: 2 });
    expect(registers.get(301)).toBe(2);
    expect(logged).toContain('The inverter took a write of [2] at 301');
    expect(port.wrote()).toEqual([301]);
    // The read-back went to the inverter, not to what the app had just sent.
    expect(port.asked()).toContain(301);
  });

  it("passes on the inverter's refusal of a write, and keeps the old value", async () => {
    port.inverter = (address, count, request) =>
      request[1] === 0x10 ? withCrc([1, 0x90, 7]) : wordsAt(address, count, () => 0);

    await expect(link.write({ OutputPriority: 2 })).rejects.toThrow(/not allowed to be modified in the current working mode/);
    await expect(link.read(['settings'])).resolves.toMatchObject({ OutputPriority: 0 });
  });

  it('says so when the inverter does not answer a write', async () => {
    port.inverter = (address, count, request) => (request[1] === 0x10 ? null : wordsAt(address, count, () => 0));

    await expect(link.write({ OutputPriority: 2 })).rejects.toThrow(/inverter did not answer/);
    expect(logged).toContain('The inverter did not answer a write of [2] at 301');
  });

  it('refuses a write the register map does not allow, without sending it to the inverter', async () => {
    port.inverter = inverterWith(new Map());
    const request = { kind: 'write', address: 202, values: [1] } as const; // mains voltage, a reading
    const frame = encodeRequest(request);

    await service.prepare(frame);
    expect(() => decodeReply(request, service.logger.handle(frame))).toThrow(/Read-only register/);
    expect(port.wrote()).toEqual([]);
  });
});
