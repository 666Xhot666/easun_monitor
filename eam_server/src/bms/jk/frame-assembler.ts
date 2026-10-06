/**
 * JK BMS Bluetooth response framing, ported from syssi/esphome-jk-bms
 * (components/jk_bms_ble/jk_bms_ble.cpp, JkBmsBle::assemble) at commit
 * 59c994e726c34b123e43eb0090736fd94706f0db.
 *
 * A response starts with 55 AA EB 90 and is checked by the byte at 299, the
 * sum of bytes 0..298 modulo 256. Some frames are longer than 300 bytes; the
 * checksum is still at 299 and the rest is ignored.
 *
 * The reference only restarts when a notification *chunk* begins with the
 * preamble, which relies on the ESP32's chunking. This scans the byte stream
 * for the preamble instead, so any chunking of the same bytes gives the same
 * frames (e.g. a preamble split across two notifications).
 */

export const RESPONSE_PREAMBLE = Buffer.from([0x55, 0xaa, 0xeb, 0x90]);
export const RESPONSE_LENGTH = 300;

export function checksum(bytes: Uint8Array, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) sum = (sum + bytes[i]) & 0xff;
  return sum;
}

export interface FrameHandlers {
  /** A complete response with a valid checksum: exactly 300 bytes. */
  onFrame: (frame: Buffer) => void;
  /** A frame was dropped (bad checksum, cut short by the next preamble). */
  onError: (reason: string) => void;
}

export class FrameAssembler {
  private buffer = Buffer.alloc(0);

  constructor(private readonly handlers: FrameHandlers) {}

  push(chunk: Uint8Array): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const start = this.buffer.indexOf(RESPONSE_PREAMBLE);
      if (start < 0) {
        // Keep a possible partial preamble at the end, drop the rest.
        this.buffer = this.buffer.subarray(
          Math.max(0, this.buffer.length - (RESPONSE_PREAMBLE.length - 1)),
        );
        return;
      }
      this.buffer = this.buffer.subarray(start);

      const next = this.buffer.indexOf(
        RESPONSE_PREAMBLE,
        RESPONSE_PREAMBLE.length,
      );
      if (next >= 0 && next < RESPONSE_LENGTH) {
        this.handlers.onError(
          `Incomplete frame dropped (${next} bytes before the next preamble)`,
        );
        this.buffer = this.buffer.subarray(next);
        continue;
      }
      if (this.buffer.length < RESPONSE_LENGTH) return;

      const frame = Buffer.from(this.buffer.subarray(0, RESPONSE_LENGTH));
      this.buffer = this.buffer.subarray(RESPONSE_LENGTH);
      const expected = checksum(frame, RESPONSE_LENGTH - 1);
      if (expected === frame[RESPONSE_LENGTH - 1]) {
        this.handlers.onFrame(frame);
      } else {
        this.handlers.onError(
          `Checksum mismatch: computed 0x${expected.toString(16)}, frame has 0x${frame[RESPONSE_LENGTH - 1].toString(16)}`,
        );
      }
    }
  }
}
