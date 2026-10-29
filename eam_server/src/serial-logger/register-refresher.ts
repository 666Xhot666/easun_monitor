import { FAILED_RETRY_MS, FRESH_MS } from './constants';
import type { ReadReply } from './esp-protocol';

/**
 * Reads register blocks through the ESP proxy when the app asks for them,
 * unless their values are fresh (FRESH_MS), whoever read them last: the
 * Wi-Fi logger or us. A block whose read failed is left to what was last
 * heard for FAILED_RETRY_MS; one the inverter refused is asked again once
 * that answer is as old as a stale value.
 */
export class RegisterRefresher {
  private readonly read: (address: number, count: number) => Promise<ReadReply | null>;
  private readonly onWords: (address: number, words: number[]) => void;
  private readonly onException: (address: number, code: number) => void;
  /** When each register's value last arrived. */
  private readonly heardAt = new Map<number, number>();
  /** When a block's read last failed or was refused, by block. */
  private readonly failedAt = new Map<string, number>();
  private readonly refusedAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(options: {
    read: (address: number, count: number) => Promise<ReadReply | null>;
    onWords: (address: number, words: number[]) => void;
    onException: (address: number, code: number) => void;
  }) {
    this.read = options.read;
    this.onWords = options.onWords;
    this.onException = options.onException;
  }

  /** Values for these registers arrived. */
  heard(address: number, count: number, now: number): void {
    for (let i = 0; i < count; i++) this.heardAt.set(address + i, now);
  }

  /** These registers may have changed (we wrote them): read them again next time. */
  stale(address: number, count: number): void {
    for (let i = 0; i < count; i++) this.heardAt.delete(address + i);
    for (const memo of [this.failedAt, this.refusedAt]) {
      for (const key of memo.keys()) {
        const [start, length] = key.split(':').map(Number);
        if (start < address + count && address < start + length) memo.delete(key);
      }
    }
  }

  /** Makes the block fresh if it is not, as far as the inverter answers. */
  refresh(address: number, count: number, now: number): Promise<void> {
    const key = `${address}:${count}`;
    const running = this.inFlight.get(key);
    if (running) return running;
    if (this.isFresh(address, count, now) || within(this.failedAt.get(key), now, FAILED_RETRY_MS) || within(this.refusedAt.get(key), now, FRESH_MS)) {
      return Promise.resolve();
    }
    const done = this.readBlock(key, address, count, now).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, done);
    return done;
  }

  private async readBlock(key: string, address: number, count: number, now: number): Promise<void> {
    const reply = await this.read(address, count);
    if (!reply) {
      this.failedAt.set(key, now);
      return;
    }
    this.failedAt.delete(key);
    if (reply.kind === 'exception') {
      this.refusedAt.set(key, now);
      this.onException(address, reply.code);
      return;
    }
    this.refusedAt.delete(key);
    this.heard(address, count, now);
    this.onWords(address, reply.words);
  }

  private isFresh(address: number, count: number, now: number): boolean {
    for (let i = 0; i < count; i++) {
      if (!within(this.heardAt.get(address + i), now, FRESH_MS)) return false;
    }
    return true;
  }
}

function within(at: number | undefined, now: number, ms: number): boolean {
  return at !== undefined && now - at < ms;
}
