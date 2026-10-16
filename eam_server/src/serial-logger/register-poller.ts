import { FAILED_RETRY_MS, REFRESH_MS, WANTED_FOR_MS } from './constants';
import type { ReadReply } from './esp-protocol';

interface Block {
  address: number;
  count: number;
  wantedAt: number;
  failedAt: number | null;
  exceptionAt: number | null;
}

/**
 * Keeps the register blocks the app reads fresh by reading them through the
 * ESP proxy: a block is read once its oldest value is REFRESH_MS old,
 * whoever read it last (the plug or us), stalest first and one at a time.
 * A failed read waits FAILED_RETRY_MS; a block the app stopped asking for
 * is dropped after WANTED_FOR_MS.
 */
export class RegisterPoller {
  private readonly read: (address: number, count: number) => Promise<ReadReply | null>;
  private readonly onWords: (address: number, words: number[]) => void;
  private readonly onException: (address: number, code: number) => void;
  private readonly blocks = new Map<string, Block>();
  /** When each register's value last arrived. */
  private readonly heardAt = new Map<number, number>();
  private busy = false;

  constructor(options: {
    read: (address: number, count: number) => Promise<ReadReply | null>;
    onWords: (address: number, words: number[]) => void;
    onException: (address: number, code: number) => void;
  }) {
    this.read = options.read;
    this.onWords = options.onWords;
    this.onException = options.onException;
  }

  /** The app asked for these registers. */
  want(address: number, count: number, now: number): void {
    const key = `${address}:${count}`;
    const block = this.blocks.get(key);
    if (block) block.wantedAt = now;
    else this.blocks.set(key, { address, count, wantedAt: now, failedAt: null, exceptionAt: null });
  }

  /** Values for these registers arrived. */
  heard(address: number, count: number, now: number): void {
    for (let i = 0; i < count; i++) this.heardAt.set(address + i, now);
  }

  /** Reads the stalest block that is due, if any; whether it read one. */
  async poll(now: number): Promise<boolean> {
    if (this.busy) return false;
    const block = this.due(now);
    if (!block) return false;

    this.busy = true;
    try {
      const reply = await this.read(block.address, block.count);
      block.failedAt = reply ? null : now;
      block.exceptionAt = reply?.kind === 'exception' ? now : null;
      if (reply?.kind === 'words') {
        this.heard(block.address, block.count, now);
        this.onWords(block.address, reply.words);
      } else if (reply?.kind === 'exception') {
        this.onException(block.address, reply.code);
      }
    } finally {
      this.busy = false;
    }
    return true;
  }

  private due(now: number): Block | null {
    let stalest: Block | null = null;
    let stalestAt = Infinity;
    for (const [key, block] of this.blocks) {
      if (now - block.wantedAt >= WANTED_FOR_MS) {
        this.blocks.delete(key);
        continue;
      }
      if (block.failedAt !== null && now - block.failedAt < FAILED_RETRY_MS) continue;
      if (block.exceptionAt !== null && now - block.exceptionAt < REFRESH_MS) continue;
      const oldest = this.oldestValue(block);
      if (oldest !== -Infinity && now - oldest < REFRESH_MS) continue;
      if (oldest < stalestAt) {
        stalest = block;
        stalestAt = oldest;
      }
    }
    return stalest;
  }

  /** When the block's oldest value arrived; -Infinity if one never did. */
  private oldestValue(block: Block): number {
    let oldest = Infinity;
    for (let i = 0; i < block.count; i++) {
      const at = this.heardAt.get(block.address + i);
      if (at === undefined) return -Infinity;
      oldest = Math.min(oldest, at);
    }
    return oldest;
  }
}
