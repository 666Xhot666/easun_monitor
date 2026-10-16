import type { SerialTap } from '../inverter/serial-sniff/serial-capture';
import { ESP_BAUD, ESP_REQUEST_TIMEOUT_MS, ESP_RETRY_INITIAL_MS, ESP_RETRY_MAX_MS } from './constants';
import { parseEspLine, parseReadReply, readRequestLine, type ReadReply } from './esp-protocol';

/** A serial port opened for reading and writing; the seam to the hardware. */
export interface DuplexPort {
  onData(listener: (chunk: Buffer) => void): void;
  onError(listener: (error: Error) => void): void;
  write(text: string): void;
  close(): Promise<void>;
}

export type DuplexPortFactory = (path: string, baudRate: number) => Promise<DuplexPort>;

export interface EspLinkStatus {
  path: string;
  state: 'open' | 'reconnecting' | 'closed';
  error: string | null;
  /** Times the port was reopened after failing. */
  reconnects: number;
}

type TapName = 'tx' | 'rx';

interface Pending {
  unit: number;
  count: number;
  bytes: Buffer;
  timer: ReturnType<typeof setTimeout>;
  resolve: (reply: ReadReply | null) => void;
}

/** The proxy's notes that end our read without a reply. */
const FAILED_NOTES = new Set(['timeout', 'busy', 'bad']);

/**
 * The USB link to the ESP proxy between the inverter and its Wi-Fi plug.
 * The plug's conversation the proxy reports comes out of two taps, as from
 * the old pair of serial taps: "tx" carries the plug's requests, "rx" the
 * inverter's replies. Our own reads go out one at a time and are answered
 * with the inverter's reply, or null when there is none. A port that fails
 * is reopened with backoff (1 s doubling to 30 s); the taps stay.
 */
export class EspLink {
  private readonly path: string;
  private readonly baudRate: number;
  private readonly openPort: DuplexPortFactory;
  private readonly onNote?: (text: string) => void;
  private port: DuplexPort | null = null;
  private stopped = true;
  private state: EspLinkStatus['state'] = 'closed';
  private error: string | null = null;
  private reconnects = 0;
  private retryMs = ESP_RETRY_INITIAL_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private partial = '';
  private readonly listeners: Record<TapName, Set<(chunk: Buffer) => void>> = { tx: new Set(), rx: new Set() };
  private queue: Promise<unknown> = Promise.resolve();
  private pending: Pending | null = null;

  constructor(options: { path: string; openPort: DuplexPortFactory; baudRate?: number; onNote?: (text: string) => void }) {
    this.path = options.path;
    this.openPort = options.openPort;
    this.baudRate = options.baudRate ?? ESP_BAUD;
    this.onNote = options.onNote;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.open();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.finish(null);
    const port = this.port;
    this.port = null;
    this.state = 'closed';
    if (port) await port.close().catch(() => {});
  }

  status(): EspLinkStatus {
    return { path: this.path, state: this.state, error: this.error, reconnects: this.reconnects };
  }

  /** A tap of the plug's conversation, in the shape SerialCapture opens. */
  openTap = async (name: string, _baudRate: number): Promise<SerialTap> => {
    if (name !== 'tx' && name !== 'rx') throw new Error(`The ESP link has the taps tx or rx, not ${name}`);
    const listeners = this.listeners[name];
    let listener: ((chunk: Buffer) => void) | null = null;
    return {
      onData: (l) => {
        listener = l;
        listeners.add(l);
      },
      onError: () => {},
      close: async () => {
        if (listener) listeners.delete(listener);
      },
    };
  };

  /** Reads `count` registers from `address` through the proxy. */
  read(unit: number, address: number, count: number): Promise<ReadReply | null> {
    const result = this.queue.then(() => this.exchange(unit, address, count));
    this.queue = result;
    return result;
  }

  private exchange(unit: number, address: number, count: number): Promise<ReadReply | null> {
    const port = this.port;
    if (!port) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finish(null), ESP_REQUEST_TIMEOUT_MS);
      this.pending = { unit, count, bytes: Buffer.alloc(0), timer, resolve };
      port.write(readRequestLine(unit, address, count));
    });
  }

  private finish(reply: ReadReply | null): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(reply);
  }

  private async open(): Promise<void> {
    let port: DuplexPort;
    try {
      port = await this.openPort(this.path, this.baudRate);
    } catch (error) {
      this.retry(messageOf(error));
      return;
    }
    if (this.stopped) {
      await port.close().catch(() => {});
      return;
    }
    port.onData((chunk) => {
      if (this.port === port) this.receive(chunk);
    });
    port.onError((error) => {
      if (this.port !== port) return;
      this.port = null;
      void port.close().catch(() => {});
      this.finish(null);
      this.retry(error.message);
    });
    if (this.state === 'reconnecting') this.reconnects++;
    this.port = port;
    this.partial = '';
    this.retryMs = ESP_RETRY_INITIAL_MS;
    this.state = 'open';
    this.error = null;
  }

  private retry(message: string): void {
    if (this.stopped) return;
    this.state = 'reconnecting';
    this.error = message;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, ESP_RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) void this.open();
    }, delay);
  }

  private receive(chunk: Buffer): void {
    const lines = (this.partial + chunk.toString('latin1')).split('\n');
    this.partial = lines.pop() ?? '';
    for (const text of lines) {
      const line = parseEspLine(text);
      if (!line) continue;
      if (line.kind === 'note') {
        if (FAILED_NOTES.has(line.text)) this.finish(null);
        this.onNote?.(line.text);
        continue;
      }
      if (line.tag === 'P>I') this.listeners.tx.forEach((l) => l(line.bytes));
      else if (line.tag === 'I>P') this.listeners.rx.forEach((l) => l(line.bytes));
      else if (line.tag === 'I>D') this.ourReply(line.bytes);
    }
  }

  private ourReply(bytes: Buffer): void {
    const pending = this.pending;
    if (!pending) return;
    pending.bytes = Buffer.concat([pending.bytes, bytes]);
    const reply = parseReadReply(pending, pending.bytes);
    if (reply) this.finish(reply);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
