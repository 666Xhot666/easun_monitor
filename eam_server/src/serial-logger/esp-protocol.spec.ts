import { crc16 } from '../inverter/protocol/logger-frame';
import { parseEspLine, parseReadReply, parseWriteReply, readRequestLine, writeRequestLine } from './esp-protocol';

const withCrc = (bytes: number[]) => Buffer.concat([Buffer.from(bytes), crc16(Buffer.from(bytes))]);

describe('parseEspLine', () => {
  it('reads a burst the proxy reports', () => {
    expect(parseEspLine('P>I 1234 01030000000AC5CD')).toEqual({
      kind: 'frame',
      tag: 'P>I',
      at: 1234,
      bytes: Buffer.from('01030000000AC5CD', 'hex'),
    });
    for (const tag of ['I>P', 'D>I', 'I>D'] as const) {
      expect(parseEspLine(`${tag} 5 ab\r`)).toMatchObject({ kind: 'frame', tag, at: 5 });
    }
  });

  it('reads notes', () => {
    expect(parseEspLine('# timeout')).toEqual({ kind: 'note', text: 'timeout' });
    expect(parseEspLine('# ready esp_proxy\r')).toEqual({ kind: 'note', text: 'ready esp_proxy' });
  });

  it('ignores what is not a line of the proxy', () => {
    for (const line of ['', 'X>Y 1 00', 'P>I 1', 'P>I x 00', 'P>I 1 0', 'P>I 1 zz', 'garbage from the boot rom']) {
      expect(parseEspLine(line)).toBeNull();
    }
  });
});

describe('readRequestLine', () => {
  it('is the hex of a Modbus read request, ended by a newline', () => {
    expect(readRequestLine(1, 0, 10)).toBe('01030000000AC5CD\n');
  });
});

describe('parseReadReply', () => {
  const request = { unit: 1, count: 2 };

  it('gives the words of a good reply', () => {
    expect(parseReadReply(request, withCrc([1, 3, 4, 0x12, 0x34, 0x00, 0x05]))).toEqual({
      kind: 'words',
      words: [0x1234, 5],
    });
  });

  it("gives the inverter's exception", () => {
    expect(parseReadReply(request, withCrc([1, 0x83, 2]))).toEqual({ kind: 'exception', code: 2 });
  });

  it('refuses a reply that does not fit the request', () => {
    expect(parseReadReply(request, withCrc([1, 3, 2, 0, 1]))).toBeNull(); // one word, two asked
    expect(parseReadReply(request, withCrc([2, 3, 4, 0, 1, 0, 2]))).toBeNull(); // other unit
    const broken = withCrc([1, 3, 4, 0, 1, 0, 2]);
    broken[broken.length - 1] ^= 0xff;
    expect(parseReadReply(request, broken)).toBeNull();
    expect(parseReadReply(request, Buffer.alloc(0))).toBeNull();
  });
});

describe('writeRequestLine', () => {
  it('asks for a Modbus write of the values, high byte first, with its CRC', () => {
    expect(writeRequestLine(1, 0x0141, [0x0001, 0x012c])).toBe('011001410002040001012C6A4E\n');
  });
});

describe('parseWriteReply', () => {
  const request = { unit: 1, address: 0x0141, count: 2 };

  it('reads the echo of a write the inverter took', () => {
    expect(parseWriteReply(request, Buffer.from('0110014100021020', 'hex'))).toEqual({ kind: 'written' });
  });

  it('reads the exception of a write the inverter refused', () => {
    expect(parseWriteReply(request, Buffer.from('019002CDC1', 'hex'))).toEqual({ kind: 'exception', code: 2 });
  });

  it('is null for anything else', () => {
    expect(parseWriteReply(request, Buffer.from('0110014100021021', 'hex'))).toBeNull();
    expect(parseWriteReply({ ...request, unit: 2 }, Buffer.from('0110014100021020', 'hex'))).toBeNull();
    expect(parseWriteReply({ ...request, count: 1 }, withCrc([1, 0x10, 0x01, 0x41, 0, 2]))).toBeNull();
    expect(parseWriteReply({ ...request, address: 0x0142 }, withCrc([1, 0x10, 0x01, 0x41, 0, 2]))).toBeNull();
    expect(parseWriteReply(request, withCrc([1, 0x03, 2, 0, 1]))).toBeNull();
    expect(parseWriteReply(request, Buffer.from('0110', 'hex'))).toBeNull();
  });
});
