import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { BmsProtocol } from '../bms/jk/variants';
import { CAPTURE_KEEP_MS, CAPTURE_ROTATE_MS } from './constants';

export interface CaptureHeader {
  kind: 'header';
  startedAt: string;
  protocol: BmsProtocol;
  decoderVersion: string;
}

type CaptureMeta = { protocol: BmsProtocol; decoderVersion: string };

/**
 * A reader session's capture: JSON lines with every raw frame as hex, each
 * decoded reading, and the connection events. Verification tooling, not
 * part of the production data path: the raw hex lets a decoder bug found
 * later be fixed by re-decoding old captures. A new file is started each
 * day, and captures not written to for two weeks are deleted.
 */
export class BmsCaptureFile {
  private constructor(
    private readonly dir: string,
    private readonly meta: CaptureMeta,
    private startedAt: Date,
    private current: string,
  ) {}

  /** The file being written to now. */
  get path(): string {
    return this.current;
  }

  static create(
    dir: string,
    meta: CaptureMeta & { startedAt: Date },
  ): BmsCaptureFile {
    mkdirSync(dir, { recursive: true });
    const { startedAt, ...rest } = meta;
    const capture = new BmsCaptureFile(dir, rest, startedAt, '');
    capture.start(startedAt);
    return capture;
  }

  frame(frameType: number, hex: string, at = new Date()): void {
    this.append({ kind: 'frame', at: at.toISOString(), frameType, hex }, at);
  }

  reading(reading: unknown, at = new Date()): void {
    this.append({ kind: 'reading', at: at.toISOString(), reading }, at);
  }

  event(event: string, detail: string, at = new Date()): void {
    this.append({ kind: 'event', at: at.toISOString(), event, detail }, at);
  }

  private append(record: object, at: Date): void {
    if (at.getTime() - this.startedAt.getTime() >= CAPTURE_ROTATE_MS) {
      this.start(at);
    }
    appendFileSync(this.current, `${JSON.stringify(record)}\n`);
  }

  /** A new file from `at`, with its header; then the old captures go. */
  private start(at: Date): void {
    const startedAt = at.toISOString();
    this.startedAt = at;
    this.current = join(this.dir, `${startedAt.replace(/[:.]/g, '-')}.jsonl`);
    const header: CaptureHeader = { kind: 'header', startedAt, ...this.meta };
    writeFileSync(this.current, `${JSON.stringify(header)}\n`);
    this.prune(at);
  }

  private prune(now: Date): void {
    for (const name of readdirSync(this.dir)) {
      const path = join(this.dir, name);
      if (!name.endsWith('.jsonl') || path === this.current) continue;
      try {
        if (now.getTime() - statSync(path).mtimeMs > CAPTURE_KEEP_MS) {
          unlinkSync(path);
        }
      } catch {
        // Gone already, or not ours to delete: left for next time.
      }
    }
  }
}

/** A capture's header and its raw frames, oldest first. */
export function readCapture(path: string): {
  header: CaptureHeader;
  frames: { at: string; frameType: number; bytes: Buffer }[];
} {
  const records = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(
      (line) =>
        JSON.parse(line) as {
          kind: string;
          at: string;
          frameType: number;
          hex: string;
        },
    );
  const [header] = records as unknown as CaptureHeader[];
  if (header?.kind !== 'header')
    throw new Error(`${path} is not a BMS capture`);
  return {
    header,
    frames: records
      .filter((r) => r.kind === 'frame')
      .map((r) => ({
        at: r.at,
        frameType: r.frameType,
        bytes: Buffer.from(r.hex, 'hex'),
      })),
  };
}
