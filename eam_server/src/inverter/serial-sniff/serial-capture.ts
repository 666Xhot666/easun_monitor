import type { CaptureStore } from './capture-store';
import type { CaptureRecord } from './capture-summary';
import { RequestResponsePairer, type PairResult } from './request-response-pairer';
import { RtuRequestParser } from './rtu-request-parser';
import { RtuResponseParser } from './rtu-response-parser';

/** A serial port opened for reading only. */
export interface SerialTap {
  onData(listener: (chunk: Buffer) => void): void;
  onError(listener: (error: Error) => void): void;
  close(): Promise<void>;
}

/** Opens a serial port read-only; the seam to the hardware. */
export type SerialTapFactory = (path: string, baudRate: number) => Promise<SerialTap>;

export type PortName = 'rx' | 'tx';

export interface PortStatus {
  path: string;
  baudRate: number;
  state: 'open' | 'reconnecting' | 'closed';
  error: string | null;
  /** Times the port was reopened after failing. */
  reconnects: number;
}

export interface CaptureStatus {
  running: boolean;
  captureId: string | null;
  ports: Record<PortName, PortStatus | null>;
  /** Write (0x10) requests heard on the request tap and not decoded. */
  skippedWrites: number;
}

export interface StartOptions {
  rxPath: string;
  txPath: string;
  rxBaud: number;
  txBaud: number;
}

const DEFAULT_MAX_RECENT = 2000;
const RETRY_INITIAL_MS = 1000;
const RETRY_MAX_MS = 30_000;

interface Port {
  status: PortStatus;
  tap: SerialTap | null;
  retryMs: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * A two-tap serial capture of the logger-inverter conversation: requests
 * from a tap on the logger's TX line, responses from a tap on its RX line.
 * Pairs them, writes every record to a capture file, and keeps recent
 * records for the live view. A port that fails is closed and reopened with
 * backoff (1 s doubling to 30 s), so a capture can run unattended; each
 * outage is recorded in the capture. Nothing is ever written to either port.
 */
export class SerialCapture {
  private readonly openTap: SerialTapFactory;
  private readonly store: CaptureStore;
  private readonly windowMs: number;
  private readonly maxRecent: number;
  private captureId: string | null = null;
  private ports: Record<PortName, Port | null> = { rx: null, tx: null };
  private pairer = new RequestResponsePairer();
  private requestParser = new RtuRequestParser();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private recent: CaptureRecord[] = [];
  private nextSeq = 1;
  /** Bumped on every start/stop, so callbacks from an old run are ignored. */
  private run = 0;

  constructor(options: { openTap: SerialTapFactory; store: CaptureStore; windowMs?: number; maxRecent?: number }) {
    this.openTap = options.openTap;
    this.store = options.store;
    this.windowMs = options.windowMs ?? 1000;
    this.maxRecent = options.maxRecent ?? DEFAULT_MAX_RECENT;
  }

  async start(options: StartOptions): Promise<void> {
    await this.stop();
    const run = ++this.run;
    this.captureId = this.store.create({ startedAt: new Date(), rxPath: options.rxPath, txPath: options.txPath });
    this.recent = [];
    this.nextSeq = 1;
    this.pairer = new RequestResponsePairer({ windowMs: this.windowMs });
    this.requestParser = new RtuRequestParser();
    this.ports = {
      rx: newPort(options.rxPath, options.rxBaud),
      tx: newPort(options.txPath, options.txBaud),
    };
    this.flushTimer = setInterval(() => this.emit(this.pairer.flush(Date.now())), Math.max(50, this.windowMs / 2));
    await this.open('rx', run);
    await this.open('tx', run);
  }

  async stop(): Promise<void> {
    this.run++;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    if (this.captureId) this.emit(this.pairer.flush(Infinity));
    for (const name of ['rx', 'tx'] as const) {
      const port = this.ports[name];
      if (!port) continue;
      if (port.retryTimer) clearTimeout(port.retryTimer);
      port.retryTimer = null;
      port.status.state = 'closed';
      const tap = port.tap;
      port.tap = null;
      if (tap) await tap.close().catch(() => {});
    }
    this.captureId = null;
  }

  status(): CaptureStatus {
    const copy = (port: Port | null) => (port ? { ...port.status } : null);
    return {
      running: this.captureId !== null,
      captureId: this.captureId,
      ports: { rx: copy(this.ports.rx), tx: copy(this.ports.tx) },
      skippedWrites: this.requestParser.skippedWrites,
    };
  }

  /** Recent records numbered after `sinceSeq`, oldest first. */
  records(sinceSeq: number): CaptureRecord[] {
    return this.recent.filter((record) => record.seq > sinceSeq);
  }

  private async open(name: PortName, run: number): Promise<void> {
    const port = this.ports[name]!;
    let tap: SerialTap;
    try {
      tap = await this.openTap(port.status.path, port.status.baudRate);
    } catch (error) {
      if (run === this.run) this.retry(name, run, messageOf(error));
      return;
    }
    if (run !== this.run) {
      await tap.close().catch(() => {});
      return;
    }

    const responses = new RtuResponseParser();
    tap.onData((chunk) => {
      if (run !== this.run || port.tap !== tap) return;
      const at = Date.now();
      if (name === 'tx') {
        for (const request of this.requestParser.push(chunk)) this.emit(this.pairer.push({ dir: 'tx', at, request }));
      } else {
        for (const response of responses.push(chunk)) this.emit(this.pairer.push({ dir: 'rx', at, response }));
      }
    });
    tap.onError((error) => {
      if (run !== this.run || port.tap !== tap) return;
      port.tap = null;
      void tap.close().catch(() => {});
      this.retry(name, run, error.message);
    });

    const reopened = port.status.state === 'reconnecting';
    port.tap = tap;
    port.retryMs = RETRY_INITIAL_MS;
    port.status = { ...port.status, state: 'open', error: null, reconnects: port.status.reconnects + (reopened ? 1 : 0) };
    this.record({ kind: 'port', at: Date.now(), port: name, state: 'open' });
  }

  private retry(name: PortName, run: number, message: string): void {
    const port = this.ports[name]!;
    if (port.status.state !== 'reconnecting') {
      this.record({ kind: 'port', at: Date.now(), port: name, state: 'reconnecting', message });
    }
    port.status = { ...port.status, state: 'reconnecting', error: message };
    const delay = port.retryMs;
    port.retryMs = Math.min(port.retryMs * 2, RETRY_MAX_MS);
    port.retryTimer = setTimeout(() => {
      port.retryTimer = null;
      if (run === this.run) void this.open(name, run);
    }, delay);
  }

  private emit(results: PairResult[]): void {
    for (const result of results) this.record(result);
  }

  private record(entry: PairResult | Omit<Extract<CaptureRecord, { kind: 'port' }>, 'seq'>): void {
    if (!this.captureId) return;
    const record = { seq: this.nextSeq++, ...entry } as CaptureRecord;
    this.store.append(this.captureId, record);
    this.recent.push(record);
    if (this.recent.length > this.maxRecent) this.recent.splice(0, this.recent.length - this.maxRecent);
  }
}

function newPort(path: string, baudRate: number): Port {
  return {
    status: { path, baudRate, state: 'closed', error: null, reconnects: 0 },
    tap: null,
    retryMs: RETRY_INITIAL_MS,
    retryTimer: null,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
