import {
  crc16,
  decodeReply,
  decodeRequest,
  encodeErrorReply,
  encodeReply,
  encodeRequest,
  frameLength,
  LoggerFrameError,
} from './logger-frame';

// Inner Modbus RTU frames below are the worked examples from the vendor's
// "SMG-RS232 Communication Protocol V1.0.1" document, so these tests pin
// the codec to the spec rather than to itself.
const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

/** Wraps an inner RTU frame the way the Wi-Fi Plug Pro does. */
const wrap = (inner: string) => {
  const payload = Buffer.concat([hex('ff04'), hex(inner)]);
  const header = Buffer.alloc(6);
  header.writeUInt16BE(0xaaaa, 0);
  header.writeUInt16BE(0x0102, 2);
  header.writeUInt16BE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

describe('crc16', () => {
  it('matches the CRC-16/MODBUS examples from the spec, low byte first', () => {
    expect(crc16(hex('01 03 00 CA 00 03'))).toEqual(hex('25 F5'));
    expect(crc16(hex('01 10 01 40 00 01 02 08 98'))).toEqual(hex('BE 3A'));
  });
});

describe('client side', () => {
  it('encodes a multi-register read request', () => {
    const frame = encodeRequest({ kind: 'read', address: 202, count: 3 });
    expect(frame).toEqual(wrap('01 03 00 CA 00 03 25 F5'));
  });

  it('decodes a read reply into raw 16-bit words', () => {
    const reply = wrap('01 03 06 08 FC 13 88 04 B0 F7 F3');
    expect(decodeReply({ kind: 'read', address: 202, count: 3 }, reply)).toEqual([
      2300, 5000, 1200,
    ]);
  });

  it('encodes a write request with the byte count', () => {
    const frame = encodeRequest({ kind: 'write', address: 320, values: [2200] });
    expect(frame).toEqual(wrap('01 10 01 40 00 01 02 08 98 BE 3A'));
  });

  it('accepts a write acknowledgement', () => {
    const ack = wrap('01 10 01 40 00 01 01 E1');
    expect(decodeReply({ kind: 'write', address: 320, values: [2200] }, ack)).toEqual([]);
  });

  it('rejects a reply whose CRC does not match', () => {
    const reply = wrap('01 03 06 08 FC 13 88 04 B0 00 00');
    expect(() => decodeReply({ kind: 'read', address: 202, count: 3 }, reply)).toThrow(
      /CRC/,
    );
  });

  it('rejects a truncated reply', () => {
    const reply = wrap('01 03 06 08 FC 13 88 04 B0 F7 F3').subarray(0, 12);
    expect(() => decodeReply({ kind: 'read', address: 202, count: 3 }, reply)).toThrow(
      LoggerFrameError,
    );
  });

  it('rejects a reply carrying a different number of registers than requested', () => {
    const reply = wrap('01 03 06 08 FC 13 88 04 B0 F7 F3');
    expect(() => decodeReply({ kind: 'read', address: 202, count: 2 }, reply)).toThrow(
      /expected 2 registers/,
    );
  });

  it('surfaces a device exception code on a rejected write', () => {
    const inner = Buffer.concat([hex('01 90 03'), crc16(hex('01 90 03'))]);
    const reply = wrap(inner.toString('hex'));
    let caught: unknown;
    try {
      decodeReply({ kind: 'write', address: 320, values: [9999] }, reply);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LoggerFrameError);
    expect((caught as LoggerFrameError).exceptionCode).toBe(3);
    expect((caught as LoggerFrameError).message).toMatch(/beyond the acceptable range/);
  });
});

describe('logger side', () => {
  it('decodes the requests the client encodes', () => {
    expect(decodeRequest(encodeRequest({ kind: 'read', address: 300, count: 11 }))).toEqual({
      kind: 'read',
      address: 300,
      count: 11,
    });
    expect(
      decodeRequest(encodeRequest({ kind: 'write', address: 320, values: [2300, 5000] })),
    ).toEqual({ kind: 'write', address: 320, values: [2300, 5000] });
  });

  it('encodes replies the client decodes', () => {
    const read = { kind: 'read', address: 202, count: 3 } as const;
    expect(encodeReply(read, [2300, 5000, 1200])).toEqual(
      wrap('01 03 06 08 FC 13 88 04 B0 F7 F3'),
    );
    expect(decodeReply(read, encodeReply(read, [1, 0xffff, 42]))).toEqual([1, 0xffff, 42]);

    const write = { kind: 'write', address: 320, values: [2200] } as const;
    expect(encodeReply(write)).toEqual(wrap('01 10 01 40 00 01 01 E1'));
  });

  it('encodes an exception reply the client reports', () => {
    const write = { kind: 'write', address: 201, values: [1] } as const;
    expect(() => decodeReply(write, encodeErrorReply(write, 1))).toThrow(/Read-only register/);
  });

  it('rejects a request with a bad CRC', () => {
    const frame = encodeRequest({ kind: 'read', address: 202, count: 3 });
    frame[frame.length - 1] ^= 0xff;
    expect(() => decodeRequest(frame)).toThrow(/CRC/);
  });
});

describe('frameLength', () => {
  const frame = wrap('01 03 06 08 FC 13 88 04 B0 F7 F3');

  it('reports the size of the first complete frame in a stream buffer', () => {
    expect(frameLength(frame)).toBe(frame.length);
    expect(frameLength(Buffer.concat([frame, frame.subarray(0, 4)]))).toBe(frame.length);
  });

  it('returns null until the whole frame has arrived', () => {
    expect(frameLength(frame.subarray(0, 4))).toBeNull();
    expect(frameLength(frame.subarray(0, frame.length - 1))).toBeNull();
  });
});
