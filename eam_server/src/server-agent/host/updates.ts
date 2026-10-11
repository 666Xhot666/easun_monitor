import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Run } from './commands';

/** Packages apt can update, as of its last package list refresh. */
export interface Updates {
  checkedAt: string;
  packages: number;
  /** Those from a -security suite. */
  security: number;
  /** At most the first 100. */
  names: string[];
  /** When apt last refreshed its package lists; the counts are as of then. */
  listsUpdatedAt: string | null;
  /** The system asks for a restart (after updates already installed). */
  rebootRequired: boolean;
}

const MAX_NAMES = 100;

const mtime = (path: string): string | null => {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
};

/**
 * What apt can update, from its cached lists (no root, nothing refreshed or
 * installed); null on a system without apt.
 */
export async function readUpdates(
  run: Run,
  root: string,
  now: Date,
): Promise<Updates | null> {
  let out: string;
  try {
    out = await run('apt', ['list', '--upgradable']);
  } catch {
    return null;
  }
  // "name/suite1,suite2 version arch [upgradable from: old]"
  const lines = out.split('\n').filter((line) => /^\S+\/\S+ /.test(line));
  return {
    checkedAt: now.toISOString(),
    packages: lines.length,
    security: lines.filter((line) => /^\S+\/\S*-security/.test(line)).length,
    names: lines.slice(0, MAX_NAMES).map((line) => line.split('/')[0]),
    listsUpdatedAt:
      mtime(join(root, 'var/lib/apt/periodic/update-success-stamp')) ??
      mtime(join(root, 'var/lib/apt/lists/partial')),
    rebootRequired:
      existsSync(join(root, 'run/reboot-required')) ||
      existsSync(join(root, 'var/run/reboot-required')),
  };
}
