import { crc16 } from '../protocol/logger-frame';

export interface RtuRequestFrame {
  unit: number;
  func: number;
  address: number;
  quantity: number;
  hex: string;
}

/** Finds Modbus RTU read requests (0x03) in raw bytes from a serial tap on the request line by checking each candidate's CRC; write requests (0x10) are recognised and skipped, not decoded. */
export class RtuRequestParser {
  skippedWrites = 0;
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): RtuRequestFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: RtuRequestFrame[] = [];

    while (true) {
      if (this.buffer.length < 8) {
        break;
      }

      const unit = this.buffer[0];
      const func = this.buffer[1];

      if (unit < 1 || unit > 247) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      if (func === 0x03) {
        const frame = this.buffer.subarray(0, 8);

        if (RtuRequestParser.isValidCrc(frame)) {
          frames.push({
            unit,
            func,
            address: frame.readUInt16BE(2),
            quantity: frame.readUInt16BE(4),
            hex: RtuRequestParser.toHex(frame),
          });
          this.buffer = this.buffer.subarray(8);
        } else {
          this.buffer = this.buffer.subarray(1);
        }
      } else if (func === 0x10) {
        const byteCount = this.buffer[6];
        const length = 9 + byteCount;

        if (this.buffer.length < length) {
          break;
        }

        const frame = this.buffer.subarray(0, length);

        if (RtuRequestParser.isValidCrc(frame)) {
          this.skippedWrites += 1;
          this.buffer = this.buffer.subarray(length);
        } else {
          this.buffer = this.buffer.subarray(1);
        }
      } else {
        this.buffer = this.buffer.subarray(1);
      }
    }

    return frames;
  }

  private static isValidCrc(frame: Buffer): boolean {
    if (frame.length < 2) {
      return false;
    }

    const computed = crc16(frame.subarray(0, frame.length - 2));
    const expected = frame.subarray(frame.length - 2);

    return computed.equals(expected);
  }

  private static toHex(frame: Buffer): string {
    const parts: string[] = [];

    for (let i = 0; i < frame.length; i += 1) {
      const hex = frame[i].toString(16);
      parts.push(hex.length === 1 ? '0' + hex : hex);
    }

    return parts.join(' ');
  }
}
