/**
 * Wire codec for the EASUN SMG-II "Wi-Fi Plug Pro" logger: a 6-byte
 * MBAP-style header plus a 2-byte outer address, wrapping a real Modbus
 * RTU frame (function 0x03 read / 0x10 write) as documented in the
 * vendor's "SMG-RS232 Communication Protocol V1.0.1".
 *
 *   aaaa 0102 000a ff 04 | 01 03 00ca 0003 25f5
 *   `- header ---' outer   `- inner RTU frame, CRC low byte first -'
 *
 * Both ends of the wire use this module: InverterService (client) and the
 * simulator in scripts/mock-inverter.ts (logger). It is pure Buffer-in,
 * Buffer-out and deliberately has no imports and only type-erasable
 * TypeScript, so Node can run it directly (type stripping) from the
 * simulator without a build step.
 */

/** Fixed transaction id: requests are strictly one at a time per logger. */
export const TRANSACTION_ID = 0xaaaa;
/** Header protocol id used by the SMG-II logger (not Modbus's 0x0000/0x0001). */
export const PROTOCOL_ID = 0x0102;
export const OUTER_UNIT_ID = 0xff;
export const OUTER_FUNCTION_CODE = 0x04;
/** Modbus unit id the SMG-II inverter answers to on the inner frame. */
export const INNER_UNIT_ID = 0x01;

const READ = 0x03;
const WRITE = 0x10;
const EXCEPTION_FLAG = 0x80;
const HEADER_LENGTH = 6;
/** Header plus the 2-byte outer address/function that precede the inner frame. */
const INNER_OFFSET = HEADER_LENGTH + 2;

/** Largest block the protocol allows in one request (Modbus limit). */
export const MAX_REGISTERS_PER_REQUEST = 125;

export type LoggerRequest =
  | { kind: 'read'; address: number; count: number }
  | { kind: 'write'; address: number; values: readonly number[] };

/** Device exception codes from the protocol document. */
const EXCEPTION_MESSAGES: Record<number, string> = {
  1: 'Read-only register',
  3: 'Write data beyond the acceptable range',
  7: 'Registers are not allowed to be modified in the current working mode',
};

export class LoggerFrameError extends Error {
  /** Device-reported exception code, when the logger rejected the request. */
  readonly exceptionCode?: number;

  constructor(message: string, exceptionCode?: number) {
    super(message);
    this.name = 'LoggerFrameError';
    this.exceptionCode = exceptionCode;
  }
}

/** CRC-16/MODBUS (poly 0xA001, init 0xFFFF), low byte first as on the wire. */
export function crc16(data: Uint8Array): Buffer {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return Buffer.from([crc & 0xff, (crc >> 8) & 0xff]);
}

// ---------------------------------------------------------------------------
// Client side
// ---------------------------------------------------------------------------

export function encodeRequest(request: LoggerRequest): Buffer {
  assertAddress(request.address);
  const body =
    request.kind === 'read'
      ? Buffer.concat([
          Buffer.from([INNER_UNIT_ID, READ]),
          word(request.address),
          word(assertCount(request.count)),
        ])
      : Buffer.concat([
          Buffer.from([INNER_UNIT_ID, WRITE]),
          word(request.address),
          word(assertCount(request.values.length)),
          Buffer.from([request.values.length * 2]),
          ...request.values.map((value) => word(assertWord(value))),
        ]);
  return wrap(withCrc(body));
}

/**
 * Validates a reply against the request it answers and returns the raw
 * unsigned 16-bit register words (empty for a write acknowledgement).
 * Throws LoggerFrameError on a malformed, mismatched or rejected reply.
 */
export function decodeReply(request: LoggerRequest, frame: Buffer): number[] {
  const inner = unwrap(frame);
  const functionCode = inner[1];
  const expectedFunction = request.kind === 'read' ? READ : WRITE;

  if (functionCode === (expectedFunction | EXCEPTION_FLAG)) {
    checkLength(inner, 5);
    checkCrc(inner.subarray(0, 5));
    const code = inner[2];
    throw new LoggerFrameError(
      `Logger rejected the request: ${EXCEPTION_MESSAGES[code] ?? `exception code ${code}`}`,
      code,
    );
  }
  if (functionCode !== expectedFunction) {
    throw new LoggerFrameError(
      `Malformed reply: expected function 0x${hex2(expectedFunction)}, got 0x${hex2(functionCode)}`,
    );
  }

  if (request.kind === 'write') {
    checkLength(inner, 8);
    checkCrc(inner.subarray(0, 8));
    const address = inner.readUInt16BE(2);
    const count = inner.readUInt16BE(4);
    if (address !== request.address || count !== request.values.length) {
      throw new LoggerFrameError(
        `Malformed reply: write acknowledged ${count} register(s) at ${address}, ` +
          `expected ${request.values.length} at ${request.address}`,
      );
    }
    return [];
  }

  checkLength(inner, 3);
  const byteCount = inner[2];
  checkLength(inner, 3 + byteCount + 2);
  checkCrc(inner.subarray(0, 3 + byteCount + 2));
  if (byteCount !== request.count * 2) {
    throw new LoggerFrameError(
      `Malformed reply: expected ${request.count} registers, got ${byteCount / 2}`,
    );
  }
  const words: number[] = [];
  for (let i = 0; i < request.count; i++) {
    words.push(inner.readUInt16BE(3 + i * 2));
  }
  return words;
}

// ---------------------------------------------------------------------------
// Logger side (used by the simulator)
// ---------------------------------------------------------------------------

export function decodeRequest(frame: Buffer): LoggerRequest {
  const inner = unwrap(frame);
  const functionCode = inner[1];

  if (functionCode === READ) {
    checkLength(inner, 8);
    checkCrc(inner.subarray(0, 8));
    return { kind: 'read', address: inner.readUInt16BE(2), count: inner.readUInt16BE(4) };
  }
  if (functionCode === WRITE) {
    checkLength(inner, 7);
    const count = inner.readUInt16BE(4);
    const byteCount = inner[6];
    if (byteCount !== count * 2) {
      throw new LoggerFrameError(
        `Malformed request: byte count ${byteCount} does not match ${count} register(s)`,
      );
    }
    checkLength(inner, 7 + byteCount + 2);
    checkCrc(inner.subarray(0, 7 + byteCount + 2));
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      values.push(inner.readUInt16BE(7 + i * 2));
    }
    return { kind: 'write', address: inner.readUInt16BE(2), values };
  }
  throw new LoggerFrameError(`Unsupported function code 0x${hex2(functionCode)}`);
}

export function encodeReply(request: LoggerRequest, values: readonly number[] = []): Buffer {
  if (request.kind === 'write') {
    return wrap(
      withCrc(
        Buffer.concat([
          Buffer.from([INNER_UNIT_ID, WRITE]),
          word(request.address),
          word(request.values.length),
        ]),
      ),
    );
  }
  if (values.length !== request.count) {
    throw new LoggerFrameError(
      `encodeReply: ${values.length} value(s) given for a ${request.count}-register read`,
    );
  }
  return wrap(
    withCrc(
      Buffer.concat([
        Buffer.from([INNER_UNIT_ID, READ, values.length * 2]),
        ...values.map((value) => word(assertWord(value))),
      ]),
    ),
  );
}

export function encodeErrorReply(request: LoggerRequest, exceptionCode: number): Buffer {
  const functionCode = (request.kind === 'read' ? READ : WRITE) | EXCEPTION_FLAG;
  return wrap(withCrc(Buffer.from([INNER_UNIT_ID, functionCode, exceptionCode])));
}

// ---------------------------------------------------------------------------
// Stream framing
// ---------------------------------------------------------------------------

/**
 * Byte length of the first complete frame at the start of `buffer`, or
 * null if more bytes are still needed. TCP may split or coalesce frames,
 * so readers accumulate data and cut frames with this.
 */
export function frameLength(buffer: Buffer): number | null {
  if (buffer.length < HEADER_LENGTH) return null;
  const total = HEADER_LENGTH + buffer.readUInt16BE(4);
  return buffer.length >= total ? total : null;
}

// ---------------------------------------------------------------------------

function wrap(inner: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from([OUTER_UNIT_ID, OUTER_FUNCTION_CODE]), inner]);
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt16BE(TRANSACTION_ID, 0);
  header.writeUInt16BE(PROTOCOL_ID, 2);
  header.writeUInt16BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function unwrap(frame: Buffer): Buffer {
  if (frame.length < INNER_OFFSET + 2) {
    throw new LoggerFrameError(`Malformed frame: only ${frame.length} byte(s)`);
  }
  const declared = HEADER_LENGTH + frame.readUInt16BE(4);
  if (frame.length < declared) {
    throw new LoggerFrameError(
      `Malformed frame: header declares ${declared} byte(s), got ${frame.length}`,
    );
  }
  return frame.subarray(INNER_OFFSET, declared);
}

function withCrc(body: Buffer): Buffer {
  return Buffer.concat([body, crc16(body)]);
}

function checkCrc(frameWithCrc: Buffer): void {
  const body = frameWithCrc.subarray(0, frameWithCrc.length - 2);
  if (!crc16(body).equals(frameWithCrc.subarray(frameWithCrc.length - 2))) {
    throw new LoggerFrameError('Malformed frame: CRC check failed');
  }
}

function checkLength(inner: Buffer, needed: number): void {
  if (inner.length < needed) {
    throw new LoggerFrameError(
      `Malformed frame: expected at least ${needed} inner byte(s), got ${inner.length}`,
    );
  }
}

function word(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

function assertWord(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new LoggerFrameError(`Register value ${value} is not an unsigned 16-bit integer`);
  }
  return value;
}

function assertAddress(address: number): void {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
    throw new LoggerFrameError(`Register address ${address} is out of range`);
  }
}

function assertCount(count: number): number {
  if (!Number.isInteger(count) || count < 1 || count > MAX_REGISTERS_PER_REQUEST) {
    throw new LoggerFrameError(
      `Register count ${count} must be between 1 and ${MAX_REGISTERS_PER_REQUEST}`,
    );
  }
  return count;
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0');
}
