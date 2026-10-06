/**
 * Requests to a JK BMS over Bluetooth, ported from syssi/esphome-jk-bms
 * (components/jk_bms_ble/jk_bms_ble.cpp, JkBmsBle::build_frame) at commit
 * 59c994e726c34b123e43eb0090736fd94706f0db.
 *
 * The characteristic that answers these also takes commands that change
 * BMS settings and switch its charge/discharge MOSFETs. This app only ever
 * asks for data: cell info and device info, with value 0 and length 0.
 * Anything else cannot be built here, and `isAllowedRequest` is what the
 * Bluetooth adapter checks before writing any bytes.
 */

export const REQUEST_PREAMBLE = [0xaa, 0x55, 0x90, 0xeb] as const;
export const REQUEST_LENGTH = 20;

/** Cell info: the BMS answers, then keeps streaming cell-info frames. */
export const CELL_INFO = 0x96;
/** Device info: model, hardware and software versions. */
export const DEVICE_INFO = 0x97;

export type ReadCommand = typeof CELL_INFO | typeof DEVICE_INFO;

const ALLOWED: ReadonlySet<number> = new Set([CELL_INFO, DEVICE_INFO]);

const sum = (bytes: Uint8Array, length: number) => {
  let total = 0;
  for (let i = 0; i < length; i++) total = (total + bytes[i]) & 0xff;
  return total;
};

/** AA 55 90 EB, command, length 0, value 0, zero padding, checksum at 19. */
export function buildRequest(command: ReadCommand): Buffer {
  if (!ALLOWED.has(command)) {
    throw new Error(
      `BMS command 0x${Number(command).toString(16)} is not allowed: only cell info and device info are read`,
    );
  }
  const frame = Buffer.alloc(REQUEST_LENGTH);
  frame.set(REQUEST_PREAMBLE, 0);
  frame[4] = command;
  frame[REQUEST_LENGTH - 1] = sum(frame, REQUEST_LENGTH - 1);
  return frame;
}

/** True only for an exact cell-info or device-info request as built above. */
export function isAllowedRequest(frame: Uint8Array): boolean {
  if (frame.length !== REQUEST_LENGTH || !ALLOWED.has(frame[4])) return false;
  return Buffer.from(frame).equals(buildRequest(frame[4] as ReadCommand));
}
