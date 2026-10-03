import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GroundTruthStore } from './ground-truth-store';

const snapshot = {
  capturedAt: '2026-10-03T21:04:18+03:00',
  source: 'vendor cloud app, Data Details screen',
  fields: { inverter: 3900, batteryVoltageV: 27.4, operatingMode: 'Mains Mode' },
  notes: ['transcribed by hand'],
};

describe('GroundTruthStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ground-truth-'));
    mkdirSync(join(dir, 'ground-truth'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const put = (name: string, content: string) => writeFileSync(join(dir, 'ground-truth', name), content);

  it('reads a hand-written snapshot from the ground-truth folder', () => {
    put('cloud-2026-10-03T21-04-18.json', JSON.stringify(snapshot));
    expect(new GroundTruthStore(dir).read('cloud-2026-10-03T21-04-18')).toEqual({
      id: 'cloud-2026-10-03T21-04-18',
      ...snapshot,
    });
  });

  it('lists snapshots newest first, skipping files that are not valid snapshots', () => {
    put('older.json', JSON.stringify({ ...snapshot, capturedAt: '2026-10-03T20:54:29+03:00' }));
    put('newer.json', JSON.stringify(snapshot));
    put('broken.json', '{"capturedAt":');
    put('no-fields.json', JSON.stringify({ capturedAt: snapshot.capturedAt }));
    put('readme.txt', 'not a snapshot');
    expect(new GroundTruthStore(dir).list()).toEqual([
      { id: 'newer', capturedAt: snapshot.capturedAt, source: snapshot.source },
      { id: 'older', capturedAt: '2026-10-03T20:54:29+03:00', source: snapshot.source },
    ]);
  });

  it('has no snapshots when the folder does not exist', () => {
    expect(new GroundTruthStore(join(dir, 'missing')).list()).toEqual([]);
  });

  it('refuses ids that are not plain names', () => {
    writeFileSync(join(dir, 'outside.json'), JSON.stringify(snapshot));
    const store = new GroundTruthStore(dir);
    expect(store.read('../outside')).toBeNull();
    expect(store.read('missing')).toBeNull();
  });
});
