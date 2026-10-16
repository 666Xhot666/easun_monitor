import { crc16 } from '../inverter/protocol/logger-frame';

export type EspTag = 'P>I' | 'I>P' | 'D>I' | 'I>D';
export type EspLine = { kind: 'frame'; tag: EspTag; at: number; bytes: Buffer } | { kind: 'note'; text: string };

/** One line from the ESP proxy over USB: "<tag> <ms> <hex>" or "# <note>"; null for anything else. */
export function parseEspLine(line: string): EspLine | null {
  const trimmed = line.replace(/\r$/, '').trim();
  if (trimmed.startsWith('# ')) {
    return { kind: 'note', text: trimmed.slice(2) };
  }
  const parts = trimmed.split(' ');
  if (parts.length !== 3) return null;
  const [tag, atStr, hex] = parts;
  if (!['P>I', 'I>P', 'D>I', 'I>D'].includes(tag)) return null;
  if (!/^\d+$/.test(atStr)) return null;
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  return { kind: 'frame', tag: tag as EspTag, at: parseInt(atStr, 10), bytes: Buffer.from(hex, 'hex') };
}

/** The line asking the proxy to send a Modbus read (function 3): upper-case hex of unit, 3, address hi/lo, count hi/lo, CRC; then "\n". */
export function readRequestLine(unit: number, address: number, count: number): string {
  const payload = Buffer.from([
    unit,
    0x03,
    (address >> 8) & 0xff,
    address & 0xff,
    (count >> 8) & 0xff,
    count & 0xff
  ]);
  const crc = crc16(payload);
  const full = Buffer.concat([payload, crc]);
  return full.toString('hex').toUpperCase() + '\n';
}

export type ReadReply = { kind: 'words'; words: number[] } | { kind: 'exception'; code: number };

/** The inverter's reply to a read of `count` registers from `unit`, or null when the bytes are not that reply (wrong unit, size or CRC). */
export function parseReadReply(request: { unit: number; count: number }, bytes: Buffer): ReadReply | null {
  if (bytes.length < 4) return null;
  const crcCalc = crc16(bytes.subarray(0, bytes.length - 2));
  if (!crcCalc.equals(bytes.subarray(bytes.length - 2))) return null;
  if (bytes[0] !== request.unit) return null;

  if (bytes.length === 5 && bytes[1] === 0x83) {
    return { kind: 'exception', code: bytes[2] };
  }

  const expectedLen = 5 + request.count * 2;
  if (bytes.length !== expectedLen || bytes[1] !== 0x03) return null;
  if (bytes[2] !== request.count * 2) return null;

  const words: number[] = [];
  for (let i = 0; i < request.count; i++) {
    const offset = 3 + i * 2;
    words.push((bytes[offset] << 8) | bytes[offset + 1]);
  }
  return { kind: 'words', words };
}
