import { RtuResponseParser } from './rtu-response-parser';

const bytes = (hex: string) => Buffer.from(hex.replace(/ /g, ''), 'hex');
// Reference frames with CRC-16/MODBUS computed independently of the app.
const ONE_WORD = '01 03 02 08 fc bf c5'; // one register = 2300
const TWO_WORDS = '01 03 04 00 14 00 32 3b e2'; // two registers = 20, 50

describe('RtuResponseParser', () => {
  it('decodes a read response into its words', () => {
    expect(new RtuResponseParser().push(bytes(ONE_WORD))).toEqual([
      { unit: 1, func: 3, byteCount: 2, words: [2300], hex: ONE_WORD },
    ]);
  });

  it('reassembles a frame split across reads', () => {
    const parser = new RtuResponseParser();
    expect(parser.push(bytes('01 03 04 00'))).toEqual([]);
    expect(parser.push(bytes('14 00 32 3b e2'))).toEqual([
      expect.objectContaining({ words: [20, 50] }),
    ]);
  });

  it('skips noise between frames', () => {
    const frames = new RtuResponseParser().push(bytes(`ff 00 ${ONE_WORD} aa ${TWO_WORDS}`));
    expect(frames.map((f) => f.words)).toEqual([[2300], [20, 50]]);
  });

  it('drops a frame whose CRC does not match, and finds the next one', () => {
    const frames = new RtuResponseParser().push(bytes(`01 03 02 08 fc bf c4 ${TWO_WORDS}`));
    expect(frames.map((f) => f.words)).toEqual([[20, 50]]);
  });

  it('ignores request frames, which carry no byte count', () => {
    expect(new RtuResponseParser().push(bytes('01 03 00 00 00 01 84 0a'))).toEqual([]);
  });
});
