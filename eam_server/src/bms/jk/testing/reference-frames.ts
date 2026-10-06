import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Response frames captured by syssi/esphome-jk-bms (Apache-2.0) for its own
 * tests, at the commit named in syssi-frames.json. Each entry keeps the
 * comment that lists the values the reference decodes from it.
 */
interface ReferenceFrames {
  source: string;
  frames: Record<
    string,
    { file: string; comment: string[]; length: number; hex: string }
  >;
}

const load = (file: string) =>
  JSON.parse(readFileSync(join(__dirname, file), 'utf8')) as ReferenceFrames;

/** The reference's frames, plus frames pinned from this installation's BMS
 * (real-frames.json, passcodes zeroed). */
const data: ReferenceFrames = {
  source: '',
  frames: {
    ...load('syssi-frames.json').frames,
    ...load('real-frames.json').frames,
  },
};

export type ReferenceFrameName = keyof typeof data.frames & string;

export function referenceFrame(name: string): Buffer {
  const frame = data.frames[name];
  if (!frame) throw new Error(`No reference frame named ${name}`);
  return Buffer.from(frame.hex, 'hex');
}
