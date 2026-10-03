import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaptureStore } from './capture-store';

describe('CaptureStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'captures-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const started = new Date('2026-10-03T12:00:00.000Z');

  it('writes a capture as JSON lines and reads it back', () => {
    const store = new CaptureStore(dir);
    const id = store.create({ startedAt: started, rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx' });
    store.append(id, { seq: 1, kind: 'port', at: 1, port: 'rx', state: 'open' });
    store.append(id, { seq: 2, kind: 'port', at: 2, port: 'tx', state: 'open' });

    expect(id).toBe('2026-10-03T12-00-00-000Z');
    expect(readFileSync(join(dir, `${id}.jsonl`), 'utf8').trim().split('\n')).toHaveLength(3);
    expect(store.read(id)).toEqual({
      meta: { id, startedAt: '2026-10-03T12:00:00.000Z', rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx' },
      records: [
        { seq: 1, kind: 'port', at: 1, port: 'rx', state: 'open' },
        { seq: 2, kind: 'port', at: 2, port: 'tx', state: 'open' },
      ],
    });
  });

  it('lists captures, newest first, and survives a new store on the same folder', () => {
    const first = new CaptureStore(dir).create({ startedAt: started, rxPath: 'a', txPath: 'b' });
    const second = new CaptureStore(dir).create({ startedAt: new Date('2026-10-03T13:00:00.000Z'), rxPath: 'c', txPath: 'd' });
    expect(new CaptureStore(dir).list().map((c) => c.id)).toEqual([second, first]);
  });

  it('skips a truncated last line, as left by a crash mid-write', () => {
    const store = new CaptureStore(dir);
    const id = store.create({ startedAt: started, rxPath: 'a', txPath: 'b' });
    store.append(id, { seq: 1, kind: 'port', at: 1, port: 'rx', state: 'open' });
    appendFileSync(join(dir, `${id}.jsonl`), '{"seq":2,"ki');
    expect(store.read(id)?.records).toHaveLength(1);
  });

  it('refuses capture ids that are not plain names', () => {
    const store = new CaptureStore(join(dir, 'captures'));
    new CaptureStore(dir).create({ startedAt: started, rxPath: 'a', txPath: 'b' }); // outside the store's folder
    expect(store.read('../2026-10-03T12-00-00-000Z')).toBeNull();
    expect(store.read('missing')).toBeNull();
  });
});
