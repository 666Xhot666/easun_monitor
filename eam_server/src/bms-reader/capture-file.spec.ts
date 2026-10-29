import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
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

  it('starts a new file each day, each with its own header', () => {
    const day = 24 * 3600_000;
    const capture = BmsCaptureFile.create(dir, {
      startedAt: new Date('2026-10-06T12:00:00Z'),
      protocol: 'JK02_32S',
      decoderVersion: 'jk-ble/1',
    });
    capture.frame(
      2,
      'aa',
      new Date(Date.parse('2026-10-06T12:00:00Z') + day - 1),
    );
    capture.frame(2, 'bb', new Date(Date.parse('2026-10-06T12:00:00Z') + day));

    expect(readdirSync(dir).sort()).toEqual([
      '2026-10-06T12-00-00-000Z.jsonl',
      '2026-10-07T12-00-00-000Z.jsonl',
    ]);
    expect(capture.path).toBe(join(dir, '2026-10-07T12-00-00-000Z.jsonl'));
    const today = readCapture(capture.path);
    expect(today.header).toMatchObject({
      startedAt: '2026-10-07T12:00:00.000Z',
      protocol: 'JK02_32S',
    });
    expect(today.frames.map((f) => f.bytes.toString('hex'))).toEqual(['bb']);
  });

  it('deletes captures not written to for two weeks, on starting and on each new day', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    const day = 24 * 3600_000;
    const old = (name: string, daysAgo: number) => {
      writeFileSync(join(dir, name), '{}\n');
      const at = new Date(now - daysAgo * day);
      utimesSync(join(dir, name), at, at);
    };
    old('2026-10-10T17-02-05-301Z.jsonl', 2); // a long session, written lately
    old('2026-10-14T00-00-00-000Z.jsonl', 14.5);
    old('notes.txt', 30); // not a capture

    const capture = BmsCaptureFile.create(dir, {
      startedAt: new Date(now),
      protocol: 'JK02_32S',
      decoderVersion: 'x',
    });
    expect(readdirSync(dir).sort()).toEqual([
      '2026-10-10T17-02-05-301Z.jsonl',
      '2026-10-29T12-00-00-000Z.jsonl',
      'notes.txt',
    ]);

    old('2026-10-10T17-02-05-301Z.jsonl', 13.5);
    capture.frame(2, 'aa', new Date(now + day));
    expect(readdirSync(dir).sort()).toEqual([
      '2026-10-29T12-00-00-000Z.jsonl',
      '2026-10-30T12-00-00-000Z.jsonl',
      'notes.txt',
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
