/**
 * An in-memory Wi-Fi Plug Pro logger: a register bank that answers wire
 * frames exactly as the real device does. Tests drive it through the
 * LoggerTransport seam, and the simulator (scripts/mock-inverter.ts) puts
 * it behind real UDP/TCP sockets.
 *
 * No framework imports and only type-erasable TypeScript, so Node can load
 * it directly from the simulator.
 */
import {
  decodeRequest,
  encodeErrorReply,
  encodeReply,
  type LoggerRequest,
} from '../protocol/logger-frame.ts';

export interface InMemoryLoggerOptions {
  /** Whether a register accepts writes (others answer exception 1). */
  isWritable: (address: number) => boolean;
  /** Supplies a value for a register that was never set (default 0). */
  valueFor?: (address: number) => number;
  /** If set, a read touching a register that was never set answers this
   * exception code instead of inventing a value. */
  unsetReadException?: number;
  /** Called after a write is stored, for logging. */
  onWrite?: (address: number, values: readonly number[]) => void;
}

export class InMemoryLogger {
  private readonly registers = new Map<number, number>();
  private readonly options: InMemoryLoggerOptions;
  private readonly rejectedReads = new Map<number, number>();
  private readonly rejectedWrites = new Map<number, number>();

  constructor(options: InMemoryLoggerOptions) {
    this.options = options;
  }

  set(address: number, words: readonly number[]): void {
    words.forEach((word, i) => this.registers.set(address + i, word));
  }

  get(address: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) => this.read(address + i));
  }

  /** Answer reads starting at `address` with a device exception. */
  rejectReadsAt(address: number, exceptionCode: number): void {
    this.rejectedReads.set(address, exceptionCode);
  }

  /** Answer writes starting at `address` with a device exception. */
  rejectWritesAt(address: number, exceptionCode: number): void {
    this.rejectedWrites.set(address, exceptionCode);
  }

  /** Handles one request frame and returns the reply frame. Throws
   * LoggerFrameError for a frame the device would drop. */
  handle(frame: Buffer): Buffer {
    const request: LoggerRequest = decodeRequest(frame);

    if (request.kind === 'read') {
      const rejected = this.rejectedReads.get(request.address);
      if (rejected !== undefined) return encodeErrorReply(request, rejected);
      const unset = this.options.unsetReadException;
      if (unset !== undefined) {
        for (let i = 0; i < request.count; i++) {
          if (!this.registers.has(request.address + i)) return encodeErrorReply(request, unset);
        }
      }
      return encodeReply(request, this.get(request.address, request.count));
    }

    const rejected = this.rejectedWrites.get(request.address);
    if (rejected !== undefined) return encodeErrorReply(request, rejected);
    for (let i = 0; i < request.values.length; i++) {
      if (!this.options.isWritable(request.address + i)) {
        return encodeErrorReply(request, 1);
      }
    }
    this.set(request.address, request.values);
    this.options.onWrite?.(request.address, request.values);
    return encodeReply(request);
  }

  private read(address: number): number {
    const stored = this.registers.get(address);
    if (stored !== undefined) return stored;
    return this.options.valueFor?.(address) ?? 0;
  }
}
