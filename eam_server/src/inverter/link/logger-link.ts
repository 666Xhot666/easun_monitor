import {
  decodeReply,
  encodeRequest,
  LoggerFrameError,
  type LoggerRequest,
} from '../protocol/logger-frame';
import {
  RegisterMap,
  wordCount,
  type Reading,
  type RegisterBlock,
  type RegisterGroup,
} from '../registers/register-map';
import { TransportError, type LoggerTransport } from './logger-transport';

export interface LoggerLinkOptions {
  transport: LoggerTransport;
  registers: RegisterMap;
  /** Wait before retrying after a link failure, doubling up to maxMs. */
  backoff?: { initialMs: number; maxMs: number };
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface LoggerLinkStatus {
  /** online: last exchange worked. backoff: failed, waiting to retry.
   * offline: never reached, or failed and due for a retry. */
  state: 'online' | 'backoff' | 'offline';
  /** Epoch ms of the last successful read or write. */
  lastSuccessAt: number | null;
  lastError: string | null;
  /** Epoch ms when the next attempt is allowed, while backing off. */
  retryAt: number | null;
}

/** The logger can't be reached right now; nothing was read or written. */
export class LoggerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoggerUnavailableError';
  }
}

const DEFAULT_BACKOFF = { initialMs: 5_000, maxMs: 5 * 60_000 };

/**
 * Everything the app does with one physical logger goes through its
 * Logger link: the handshake and connection, one request at a time (the
 * wire protocol cannot match out-of-order replies), register reads in as
 * few block requests as possible, validated writes with read-back, and
 * backing off after the link fails instead of hammering an unreachable
 * device.
 */
export class LoggerLink {
  private readonly transport: LoggerTransport;
  private readonly registers: RegisterMap;
  private readonly backoff: { initialMs: number; maxMs: number };
  private readonly now: () => number;

  private queue: Promise<unknown> = Promise.resolve();
  private failures = 0;
  private lastSuccessAt: number | null = null;
  private lastError: string | null = null;
  private retryAt: number | null = null;

  constructor(options: LoggerLinkOptions) {
    this.transport = options.transport;
    this.registers = options.registers;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.now = options.now ?? Date.now;
  }

  /**
   * Reads every register of the given groups. A block the logger rejects
   * or garbles is left out of the reading; a broken link aborts the whole
   * read with LoggerUnavailableError.
   */
  read(groups: readonly RegisterGroup[]): Promise<Reading> {
    return this.serialize(async () => {
      await this.ensureConnected();
      const reading: Reading = {};
      for (const block of groups.flatMap((group) => this.registers.blocks(group))) {
        try {
          const words = await this.request({ kind: 'read', ...block });
          Object.assign(reading, this.registers.decodeBlock(block, words));
        } catch (error) {
          if (!(error instanceof LoggerFrameError)) throw error;
        }
      }
      this.markSuccess();
      return reading;
    });
  }

  /**
   * Writes settings (register name -> real value) and returns the values
   * read back from the device afterwards. Every value is validated against
   * the Register map before anything is sent (RegisterValueError); a value
   * the device refuses surfaces as LoggerFrameError.
   */
  async write(changes: Record<string, number>): Promise<Reading> {
    const writes = Object.entries(changes).map(([name, value]) => ({
      name,
      ...this.registers.encode(name, value),
    }));

    return this.serialize(async () => {
      await this.ensureConnected();
      for (const { address, values } of writes) {
        await this.request({ kind: 'write', address, values });
      }
      const confirmed: Reading = {};
      for (const { name } of writes) {
        const definition = this.registers.get(name)!;
        const block: RegisterBlock = { address: definition.address, count: wordCount(definition) };
        const words = await this.request({ kind: 'read', ...block });
        confirmed[name] = this.registers.decodeBlock(block, words)[name];
      }
      this.markSuccess();
      return confirmed;
    });
  }

  /**
   * Sends a write-only command register (e.g. "exit fault mode"). Validated
   * like a setting, but not read back: commands have no value to confirm.
   */
  async command(name: string, value: number): Promise<void> {
    const { address, values } = this.registers.encode(name, value);
    await this.serialize(async () => {
      await this.ensureConnected();
      await this.request({ kind: 'write', address, values });
      this.markSuccess();
    });
  }

  /** One full round trip (handshake, connect, one CRC-checked register
   * read), used to verify a logger before pairing it. */
  probe(): Promise<{ latencyMs: number; sampledRegister: string }> {
    const [sample] = this.registers.list('telemetry');
    return this.serialize(async () => {
      const startedAt = this.now();
      await this.ensureConnected();
      await this.request({ kind: 'read', address: sample.address, count: wordCount(sample) });
      this.markSuccess();
      return { latencyMs: this.now() - startedAt, sampledRegister: sample.name };
    });
  }

  status(): LoggerLinkStatus {
    let state: LoggerLinkStatus['state'];
    if (this.lastError === null) {
      state = this.lastSuccessAt === null ? 'offline' : 'online';
    } else {
      state = this.retryAt !== null && this.now() < this.retryAt ? 'backoff' : 'offline';
    }
    return {
      state,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      retryAt: this.retryAt,
    };
  }

  close(): void {
    this.transport.close();
  }

  // -------------------------------------------------------------------------

  /** Runs `task` after every previously queued task has settled. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async ensureConnected(): Promise<void> {
    if (this.retryAt !== null && this.now() < this.retryAt) {
      const seconds = Math.ceil((this.retryAt - this.now()) / 1000);
      throw new LoggerUnavailableError(
        `Logger unreachable (${this.lastError}); retrying in ${seconds}s`,
      );
    }
    if (this.transport.connected) return;
    try {
      await this.transport.connect();
    } catch (error) {
      throw this.fail(error);
    }
  }

  private async request(request: LoggerRequest): Promise<number[]> {
    let reply: Buffer;
    try {
      reply = await this.transport.exchange(encodeRequest(request));
    } catch (error) {
      throw this.fail(error);
    }
    return decodeReply(request, reply);
  }

  /** Records a link failure, schedules the retry, and returns the error to throw. */
  private fail(error: unknown): Error {
    if (!(error instanceof TransportError)) return error as Error;
    this.transport.close();
    this.failures++;
    const delay = Math.min(
      this.backoff.initialMs * 2 ** (this.failures - 1),
      this.backoff.maxMs,
    );
    this.retryAt = this.now() + delay;
    this.lastError = error.message;
    return new LoggerUnavailableError(`Logger unreachable: ${error.message}`);
  }

  private markSuccess(): void {
    this.failures = 0;
    this.retryAt = null;
    this.lastError = null;
    this.lastSuccessAt = this.now();
  }
}
