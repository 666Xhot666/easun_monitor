import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BmsCaptureFile, readCapture } from './capture-file';

describe('BmsCaptureFile', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'bms-capture-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a header, then one JSON line per frame, reading and event', () => {
    const capture = BmsCaptureFile.create(dir, {
      startedAt: new Date('2026-10-06T12:00:00Z'),
      protocol: 'JK02_32S',
      decoderVersion: 'jk-ble/1',
    });
    capture.frame(2, 'aabb', new Date('2026-10-06T12:00:01Z'));
    capture.reading({ stateOfChargePct: 88 }, new Date('2026-10-06T12:00:01Z'));
    capture.event(
      'disconnect',
      'out of range',
      new Date('2026-10-06T12:00:02Z'),
    );

    const [file] = readdirSync(dir);
    expect(file).toBe('2026-10-06T12-00-00-000Z.jsonl');
    const lines = readFileSync(join(dir, file), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      {
        kind: 'header',
        startedAt: '2026-10-06T12:00:00.000Z',
        protocol: 'JK02_32S',
        decoderVersion: 'jk-ble/1',
      },
      {
        kind: 'frame',
        at: '2026-10-06T12:00:01.000Z',
        frameType: 2,
        hex: 'aabb',
      },
      {
        kind: 'reading',
        at: '2026-10-06T12:00:01.000Z',
        reading: { stateOfChargePct: 88 },
      },
      {
        kind: 'event',
        at: '2026-10-06T12:00:02.000Z',
        event: 'disconnect',
        detail: 'out of range',
      },
    ]);
  });

  it('reads the frames of a capture back, for re-decoding', () => {
    const capture = BmsCaptureFile.create(dir, {
      startedAt: new Date(0),
      protocol: 'JK02_24S',
      decoderVersion: 'x',
    });
    capture.frame(3, '0102', new Date(1000));
    capture.event('connect', 'JK-B2A8S20P', new Date(1500));
    capture.frame(2, '0304', new Date(2000));

    const read = readCapture(capture.path);
    expect(read.header.protocol).toBe('JK02_24S');
    expect(read.frames).toEqual([
      {
        at: new Date(1000).toISOString(),
        frameType: 3,
        bytes: Buffer.from([1, 2]),
      },
      {
        at: new Date(2000).toISOString(),
        frameType: 2,
        bytes: Buffer.from([3, 4]),
      },
    ]);
  });
});
