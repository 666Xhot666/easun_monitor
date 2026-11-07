import type { BmsReading } from '../bms/reading';
import type { BmsSettingsReport } from '../bms/settings-report';
import { INGEST_RETRY_FIRST_MS, INGEST_RETRY_MAX_MS } from './constants';

export interface IngestClientOptions {
  /** The server's ingest endpoint (BMS_INGEST_URL); settings go to <url>/settings. */
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
  /** The newest settings not yet delivered; a newer report replaces it. */
  private pendingSettings: BmsSettingsReport | null = null;
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

  /** Settings are sent before queued readings, and only the newest is kept. */
  offerSettings(report: BmsSettingsReport): void {
    this.pendingSettings = report;
    void this.pump();
  }

  private next(): { what: string; url: string; body: object } | null {
    if (this.pendingSettings) {
      return {
        what: `settings of ${this.pendingSettings.timestamp}`,
        url: `${this.options.url.replace(/\/+$/, '')}/settings`,
        body: this.pendingSettings,
      };
    }
    const reading = this.queue[0];
    if (!reading) return null;
    return {
      what: `reading of ${reading.timestamp}`,
      url: this.options.url,
      body: reading,
    };
  }

  private done(body: object): void {
    if (this.pendingSettings === body) this.pendingSettings = null;
    else if (this.queue[0] === body) this.queue.shift();
  }

  private async pump(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    let delay = INGEST_RETRY_FIRST_MS;
    try {
      for (let item = this.next(); item; item = this.next()) {
        let status: number;
        try {
          status = await this.post(item.url, item.body);
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
          delay = Math.min(delay * 2, INGEST_RETRY_MAX_MS);
          continue;
        }
        // Delivered, already stored (409), or rejected for good (other 4xx).
        this.done(item.body);
        if (status >= 400 && status !== 409) {
          this.options.onEvent(
            `Server rejected the ${item.what} (${status}); dropped`,
          );
        }
        delay = INGEST_RETRY_FIRST_MS;
      }
    } finally {
      this.sending = false;
    }
  }

  private async post(url: string, body: object): Promise<number> {
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.token}`,
      },
      body: JSON.stringify(body),
    });
    return response.status;
  }
}
