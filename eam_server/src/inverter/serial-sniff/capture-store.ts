import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaptureRecord } from './capture-summary';

export interface CaptureMeta {
  id: string;
  startedAt: string;
  rxPath: string;
  txPath: string;
}

/** Capture ids are file names we made; anything else is refused. */
const ID = /^[\w-]+$/;

/**
 * Serial captures as JSON-lines files, one per capture: a header line with
 * the capture's settings, then one line per record. Plain files so a
 * capture outlives the page and the server, without a database table for a
 * dev-only tool.
 */
export class CaptureStore {
  constructor(private readonly dir: string) {}

  create(meta: { startedAt: Date; rxPath: string; txPath: string }): string {
    mkdirSync(this.dir, { recursive: true });
    const startedAt = meta.startedAt.toISOString();
    const id = startedAt.replace(/[:.]/g, '-');
    writeFileSync(this.file(id), `${JSON.stringify({ id, startedAt, rxPath: meta.rxPath, txPath: meta.txPath })}\n`);
    return id;
  }

  append(id: string, record: CaptureRecord): void {
    appendFileSync(this.file(id), `${JSON.stringify(record)}\n`);
  }

  /** Every capture's header, newest first. */
  list(): CaptureMeta[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => this.read(name.slice(0, -'.jsonl'.length))?.meta)
      .filter((meta): meta is CaptureMeta => meta !== undefined)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** A capture's header and records; null if there is no such capture. */
  read(id: string): { meta: CaptureMeta; records: CaptureRecord[] } | null {
    if (!ID.test(id) || !existsSync(this.file(id))) return null;
    const [header, ...lines] = readFileSync(this.file(id), 'utf8').split('\n');
    const records: CaptureRecord[] = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        records.push(JSON.parse(line) as CaptureRecord);
      } catch {
        // A line cut short by a crash mid-write; the rest is still good.
      }
    }
    return { meta: JSON.parse(header) as CaptureMeta, records };
  }

  private file(id: string): string {
    return join(this.dir, `${id}.jsonl`);
  }
}
