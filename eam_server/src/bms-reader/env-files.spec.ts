import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFiles } from './env-files';

describe('loadEnvFiles', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'env-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('fills in settings from the files, earlier files and the environment winning', () => {
    writeFileSync(
      join(dir, 'server.env'),
      'BMS_ID=from-server-env\nBMS_PROTOCOL=JK02_24S\n',
    );
    writeFileSync(
      join(dir, 'root.env'),
      'BMS_ID=from-root\nBMS_NAME=JK-\nBMS_INGEST_URL=http://x/api/bms/ingest\n',
    );
    const env: Record<string, string | undefined> = {
      BMS_PROTOCOL: 'JK02_32S',
    };

    const loaded = loadEnvFiles(
      [
        join(dir, 'server.env'),
        join(dir, 'missing.env'),
        join(dir, 'root.env'),
      ],
      env,
    );

    expect(env).toEqual({
      BMS_PROTOCOL: 'JK02_32S',
      BMS_ID: 'from-server-env',
      BMS_NAME: 'JK-',
      BMS_INGEST_URL: 'http://x/api/bms/ingest',
    });
    expect(loaded).toEqual([join(dir, 'server.env'), join(dir, 'root.env')]);
  });

  it('treats an empty value as unset, so a later file can still provide it', () => {
    writeFileSync(join(dir, 'a.env'), 'BMS_ID=\n');
    writeFileSync(join(dir, 'b.env'), 'BMS_ID=abc\n');
    const env: Record<string, string | undefined> = {};

    loadEnvFiles([join(dir, 'a.env'), join(dir, 'b.env')], env);

    expect(env.BMS_ID).toBe('abc');
  });
});
