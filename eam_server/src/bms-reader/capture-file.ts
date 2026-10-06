import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { BmsProtocol } from '../bms/jk/variants';

export interface CaptureHeader {
  kind: 'header';
  startedAt: string;
  protocol: BmsProtocol;
  decoderVersion: string;
}

/**
 * A reader session's capture: JSON lines with every raw frame as hex, each
 * decoded reading, and the connection events. Verification tooling, not
 * part of the production data path: the raw hex lets a decoder bug found
 * later be fixed by re-decoding old captures.
 */
export class BmsCaptureFile {
  private constructor(readonly path: string) {}

  static create(
    dir: string,
    meta: { startedAt: Date; protocol: BmsProtocol; decoderVersion: string },
  ): BmsCaptureFile {
    mkdirSync(dir, { recursive: true });
    const startedAt = meta.startedAt.toISOString();
    const path = join(dir, `${startedAt.replace(/[:.]/g, '-')}.jsonl`);
    const header: CaptureHeader = {
      kind: 'header',
      startedAt,
      protocol: meta.protocol,
      decoderVersion: meta.decoderVersion,
    };
    writeFileSync(path, `${JSON.stringify(header)}\n`);
    return new BmsCaptureFile(path);
  }

  frame(frameType: number, hex: string, at = new Date()): void {
    this.append({ kind: 'frame', at: at.toISOString(), frameType, hex });
  }

  reading(reading: unknown, at = new Date()): void {
    this.append({ kind: 'reading', at: at.toISOString(), reading });
  }

  event(event: string, detail: string, at = new Date()): void {
    this.append({ kind: 'event', at: at.toISOString(), event, detail });
  }

  private append(record: object): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`);
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
