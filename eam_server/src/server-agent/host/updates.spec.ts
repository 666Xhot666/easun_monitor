import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUpdates } from './updates';

const LIST = [
  'Listing...',
  'openssl/noble-updates,noble-security 3.0.13-0ubuntu3.5 amd64 [upgradable from: 3.0.13-0ubuntu3.4]',
  'libssl3t64/noble-updates,noble-security 3.0.13-0ubuntu3.5 amd64 [upgradable from: 3.0.13-0ubuntu3.4]',
  'snapd/noble-updates 2.66 amd64 [upgradable from: 2.65]',
  '',
].join('\n');

function host(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'host-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe('readUpdates', () => {
  const now = new Date('2026-10-11T10:00:00Z');

  it('counts the packages that can be updated, and the security ones', async () => {
    const root = host({ 'var/lib/apt/periodic/update-success-stamp': '' });
    const stamp = new Date('2026-10-11T08:00:00Z');
    utimesSync(
      join(root, 'var/lib/apt/periodic/update-success-stamp'),
      stamp,
      stamp,
    );

    const run = (command: string, args: string[]) =>
      command === 'apt' && args.join(' ') === 'list --upgradable'
        ? Promise.resolve(LIST)
        : Promise.reject(new Error('unexpected'));
    expect(await readUpdates(run, root, now)).toEqual({
      checkedAt: '2026-10-11T10:00:00.000Z',
      packages: 3,
      security: 2,
      names: ['openssl', 'libssl3t64', 'snapd'],
      listsUpdatedAt: '2026-10-11T08:00:00.000Z',
      rebootRequired: false,
    });
  });

  it('says when a restart is needed', async () => {
    const root = host({
      'run/reboot-required': '*** System restart required ***\n',
    });
    const updates = await readUpdates(
      () => Promise.resolve('Listing...\n'),
      root,
      now,
    );
    expect(updates).toMatchObject({
      packages: 0,
      security: 0,
      rebootRequired: true,
      listsUpdatedAt: null,
    });
  });

  it('gives nothing on a system without apt', async () => {
    expect(
      await readUpdates(() => Promise.reject(new Error('ENOENT')), host(), now),
    ).toBeNull();
  });
});
