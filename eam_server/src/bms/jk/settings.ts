/**
 * JK BMS settings frame (type 0x01): the limits and switches set in the JK
 * app. The BMS sends it once after each connect, before cell info streams.
 * Read-only: nothing here builds a command that changes a setting.
 *
 * Where each setting sits is data, in settings-layout.json. It is confirmed
 * for JK02_32S against this installation's BMS and the JK app; the other
 * variants are declined until a real unit confirms their layout.
 */
import layout from './settings-layout.json';
import type { BmsProtocol } from './variants';

export const SETTINGS_FRAME = 0x01;

type FieldType = 'u32' | 'i32' | 'flag';

interface LayoutField {
  name: string;
  offset: number;
  type: FieldType;
  divisor?: number;
}

const FIELDS = layout.fields as LayoutField[];

/** Setting name (as in settings-layout.json) → value in V, A, s, °C or Ah; flags as booleans. */
export type BmsSettings = Record<string, number | boolean>;

const read = (frame: Buffer, field: LayoutField): number | boolean => {
  switch (field.type) {
    case 'flag':
      return frame.readUInt32LE(field.offset) !== 0;
    case 'i32':
      return frame.readInt32LE(field.offset) / (field.divisor ?? 1);
    case 'u32':
      return frame.readUInt32LE(field.offset) / (field.divisor ?? 1);
  }
};

export function decodeSettings(
  frame: Buffer,
  protocol: BmsProtocol,
): BmsSettings {
  if (frame[4] !== SETTINGS_FRAME) {
    throw new Error(`Not a settings frame (type 0x${frame[4].toString(16)})`);
  }
  if (protocol !== 'JK02_32S') {
    throw new Error(
      `The ${protocol} settings layout is not confirmed yet; only JK02_32S is decoded`,
    );
  }
  return Object.fromEntries(FIELDS.map((f) => [f.name, read(frame, f)]));
}
