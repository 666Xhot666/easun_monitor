import { RtuResponseParser, type RtuResponseFrame } from './rtu-response-parser';

/** A serial port opened for reading only. */
export interface SerialTap {
  onData(listener: (chunk: Buffer) => void): void;
  onError(listener: (error: Error) => void): void;
  close(): Promise<void>;
}

/** Opens a serial port read-only; the seam to the hardware. */
export type SerialTapFactory = (path: string, baudRate: number) => Promise<SerialTap>;

/** A response frame heard on the tap, numbered in capture order. */
export interface CapturedFrame extends RtuResponseFrame {
  seq: number;
  receivedAt: string;
  note?: string;
}

export interface SnifferStatus {
  running: boolean;
  path: string | null;
  error: string | null;
}

/** The logger's TTL side runs at 9600 8N1. */
const BAUD_RATE = 9600;
const DEFAULT_MAX_FRAMES = 2000;

/**
 * Listens to the inverter's replies on a receive-only serial tap (the
 * Wi-Fi logger's RX pad) and keeps the most recent frames for the dev
 * panel. Receive-only means requests are never seen, so a frame's register
 * address is unknown: frames are only numbered, never named.
 */
export class SerialSniffer {
  private readonly maxFrames: number;
  private readonly now: () => Date;
  private tap: SerialTap | null = null;
  private captured: CapturedFrame[] = [];
  private nextSeq = 1;
  private state: SnifferStatus = { running: false, path: null, error: null };

  constructor(
    private readonly openTap: SerialTapFactory,
    options: { maxFrames?: number; now?: () => Date } = {},
  ) {
    this.maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
    this.now = options.now ?? (() => new Date());
  }

  /** Starts listening on `path`, closing any port already open. */
  async start(path: string): Promise<void> {
    await this.stop();
    let tap: SerialTap;
    try {
      tap = await this.openTap(path, BAUD_RATE);
    } catch (error) {
      this.state = { running: false, path, error: messageOf(error) };
      throw error;
    }
    const parser = new RtuResponseParser();
    tap.onData((chunk) => {
      if (this.tap !== tap) return;
      for (const frame of parser.push(chunk)) this.record(frame);
    });
    tap.onError((error) => {
      if (this.tap !== tap) return;
      this.tap = null;
      this.state = { running: false, path, error: error.message };
      void tap.close().catch(() => {});
    });
    this.tap = tap;
    this.state = { running: true, path, error: null };
  }

  async stop(): Promise<void> {
    const tap = this.tap;
    this.tap = null;
    this.state = { ...this.state, running: false };
    if (tap) await tap.close();
  }

  status(): SnifferStatus {
    return { ...this.state };
  }

  /** Frames numbered after `sinceSeq`, oldest first. */
  frames(sinceSeq: number): CapturedFrame[] {
    return this.captured.filter((frame) => frame.seq > sinceSeq).map((frame) => ({ ...frame }));
  }

  /** Attaches a note to a frame still in the buffer; false if it is gone. */
  note(seq: number, text: string): boolean {
    const frame = this.captured.find((f) => f.seq === seq);
    if (!frame) return false;
    frame.note = text;
    return true;
  }

  private record(frame: RtuResponseFrame): void {
    this.captured.push({ seq: this.nextSeq++, receivedAt: this.now().toISOString(), ...frame });
    if (this.captured.length > this.maxFrames) {
      this.captured.splice(0, this.captured.length - this.maxFrames);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
