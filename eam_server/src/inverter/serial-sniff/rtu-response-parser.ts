import { crc16 } from '../protocol/logger-frame';

/** A Modbus RTU read (0x03) response heard on the wire. */
export interface RtuResponseFrame {
  unit: number;
  func: number;
  byteCount: number;
  /** The data as big-endian 16-bit words; which registers they are is unknown. */
  words: number[];
  /** Every byte of the frame as lowercase hex, space separated. */
  hex: string;
}

const READ_HOLDING_REGISTERS = 0x03;
/** unit + func + byte count + CRC. */
const OVERHEAD = 5;

/**
 * Finds Modbus RTU read responses in raw serial bytes from a receive-only
 * tap: tries a frame at every offset and keeps it only if its CRC-16/MODBUS
 * matches, so line noise and partial frames are skipped. Never infers
 * register addresses; those are only in the requests, which a receive-only
 * tap does not hear.
 */
export class RtuResponseParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): RtuResponseFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: RtuResponseFrame[] = [];

    while (this.buffer.length >= OVERHEAD) {
      const [unit, func, byteCount] = this.buffer;
      const plausible =
        unit >= 1 && unit <= 247 && func === READ_HOLDING_REGISTERS && byteCount > 0 && byteCount % 2 === 0 && byteCount <= 250;
      if (!plausible) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      const length = byteCount + OVERHEAD;
      if (this.buffer.length < length) break;

      const frame = this.buffer.subarray(0, length);
      if (!crc16(frame.subarray(0, length - 2)).equals(frame.subarray(length - 2))) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      const words: number[] = [];
      for (let i = 3; i < length - 2; i += 2) words.push(frame.readUInt16BE(i));
      frames.push({ unit, func, byteCount, words, hex: [...frame].map((b) => b.toString(16).padStart(2, '0')).join(' ') });
      this.buffer = this.buffer.subarray(length);
    }
    return frames;
  }
}
