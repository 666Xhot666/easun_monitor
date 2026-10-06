import { FrameAssembler } from './frame-assembler';
import { referenceFrame } from './testing/reference-frames';

// Vectors: response frames from syssi/esphome-jk-bms's own tests (see testing/).
const deviceInfo = referenceFrame('DEVICE_INFO_JK02_32S_V11');
const cellInfo = referenceFrame('CELL_INFO_JK02_32S_V11');

function feed(chunks: Buffer[]) {
  const frames: Buffer[] = [];
  const errors: string[] = [];
  const assembler = new FrameAssembler({
    onFrame: (frame) => frames.push(frame),
    onError: (reason) => errors.push(reason),
  });
  for (const chunk of chunks) assembler.push(chunk);
  return { frames, errors };
}

/** Splits a buffer into chunks of the given sizes, repeating the pattern. */
function chunked(buffer: Buffer, sizes: number[]): Buffer[] {
  const chunks: Buffer[] = [];
  for (let at = 0, i = 0; at < buffer.length; i++) {
    const size = sizes[i % sizes.length];
    chunks.push(buffer.subarray(at, at + size));
    at += size;
  }
  return chunks;
}

describe('FrameAssembler', () => {
  const stream = Buffer.concat([deviceInfo, cellInfo, cellInfo]);

  it('yields the same frames however the notifications are chunked', () => {
    for (const sizes of [
      [stream.length],
      [20],
      [1],
      [3, 128, 7],
      [299, 2],
      [150, 151],
    ]) {
      const { frames, errors } = feed(chunked(stream, sizes));
      expect(frames.map((f) => f.toString('hex'))).toEqual(
        [deviceInfo, cellInfo, cellInfo].map((f) => f.toString('hex')),
      );
      expect(errors).toEqual([]);
    }
  });

  it('skips bytes before the first preamble', () => {
    const { frames } = feed([Buffer.from([0x01, 0x02, 0x55, 0xaa]), cellInfo]);
    expect(frames).toEqual([cellInfo]);
  });

  it('ignores the tail of a frame longer than 300 bytes', () => {
    const long = Buffer.concat([cellInfo, Buffer.alloc(20, 0x42)]);
    const { frames } = feed(chunked(Buffer.concat([long, deviceInfo]), [64]));
    expect(frames).toEqual([cellInfo, deviceInfo]);
  });

  it('drops a frame whose checksum at byte 299 does not match, and recovers', () => {
    const corrupt = Buffer.from(cellInfo);
    corrupt[200] ^= 0xff;
    const { frames, errors } = feed([corrupt, deviceInfo]);
    expect(frames).toEqual([deviceInfo]);
    expect(errors).toEqual([expect.stringMatching(/checksum/i)]);
  });

  it('starts over when a new preamble arrives before a frame is complete', () => {
    const { frames, errors } = feed([cellInfo.subarray(0, 120), deviceInfo]);
    expect(frames).toEqual([deviceInfo]);
    expect(errors).toEqual([expect.stringMatching(/incomplete/i)]);
  });
});
