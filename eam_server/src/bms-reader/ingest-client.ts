import type { BmsReading } from '../bms/reading';

const FIRST_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export interface IngestClientOptions {
  /** The server's ingest endpoint (BMS_INGEST_URL). */
  url: string;
  /** This BMS device's ingest token (BMS_INGEST_TOKEN). */
  token: string;
  fetch?: typeof fetch;
  /** Readings closer together than this (by their timestamps) are skipped. */
  minIntervalMs: number;
  /** At most this many readings wait for the server; the oldest go first. */
  maxQueue: number;
  onEvent: (message: string) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Delivers readings to the server's ingest endpoint. While the server is
 * unreachable it keeps a bounded queue (the last few minutes) and retries
 * with backoff; it never buffers without limit.
 */
export class IngestClient {
  private readonly queue: BmsReading[] = [];
  private lastQueuedAt: number | null = null;
  private sending = false;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: IngestClientOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  offer(reading: BmsReading): void {
    const at = Date.parse(reading.timestamp);
    if (
      this.lastQueuedAt !== null &&
      at - this.lastQueuedAt < this.options.minIntervalMs
    )
      return;
    this.lastQueuedAt = at;
    this.queue.push(reading);
    while (this.queue.length > this.options.maxQueue) this.queue.shift();
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    let delay = FIRST_DELAY_MS;
    try {
      while (this.queue.length > 0) {
        const reading = this.queue[0];
        let status: number;
        try {
          status = await this.post(reading);
        } catch (error) {
          status = 0;
          this.options.onEvent(
            `Server unreachable (${error instanceof Error ? error.message : String(error)}); retrying in ${delay / 1000} s`,
          );
        }
        if (status === 0 || status >= 500 || status === 429) {
          if (status !== 0)
            this.options.onEvent(
              `Server answered ${status}; retrying in ${delay / 1000} s`,
            );
          await sleep(delay);
          delay = Math.min(delay * 2, MAX_DELAY_MS);
          continue;
        }
        // Delivered, already stored (409), or rejected for good (other 4xx).
        if (this.queue[0] === reading) this.queue.shift();
        if (status >= 400 && status !== 409) {
          this.options.onEvent(
            `Server rejected the reading of ${reading.timestamp} (${status}); dropped`,
          );
        }
        delay = FIRST_DELAY_MS;
      }
    } finally {
      this.sending = false;
    }
  }

  private async post(reading: BmsReading): Promise<number> {
    const response = await this.fetch(this.options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.token}`,
      },
      body: JSON.stringify(reading),
    });
    return response.status;
  }
}
