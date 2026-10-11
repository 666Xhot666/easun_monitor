import { readFileSync, statfsSync } from 'node:fs';
import { join } from 'node:path';

/** Filesystems on real storage; pseudo, memory and overlay ones are left out. */
const REAL = new Set([
  'ext2',
  'ext3',
  'ext4',
  'xfs',
  'btrfs',
  'f2fs',
  'vfat',
  'exfat',
  'zfs',
]);

export interface Disk {
  mount: string;
  totalBytes: number;
  /** Free for ordinary users (excluding root's reserve). */
  freeBytes: number;
}

type StatFs = (path: string) => {
  bsize: number;
  blocks: number;
  bavail: number;
};

/** The mount points of real filesystems, each device once (its first mount). */
export function readMounts(root: string): string[] {
  const seen = new Set<string>();
  const mounts: string[] = [];
  for (const line of readFileSync(join(root, 'proc/mounts'), 'utf8').split(
    '\n',
  )) {
    const [device, mount, type] = line.split(' ');
    if (!mount || !REAL.has(type) || seen.has(device)) continue;
    seen.add(device);
    // Spaces and the like are written as octal escapes, e.g. \040.
    mounts.push(
      mount.replace(/\\([0-7]{3})/g, (_, o: string) =>
        String.fromCharCode(parseInt(o, 8)),
      ),
    );
  }
  return mounts;
}

/** Size and free space of each real filesystem; one that cannot be read is skipped. */
export function readDisks(root: string, statfs: StatFs = statfsSync): Disk[] {
  const disks: Disk[] = [];
  for (const mount of readMounts(root)) {
    try {
      const s = statfs(join(root, mount));
      disks.push({
        mount,
        totalBytes: s.blocks * s.bsize,
        freeBytes: s.bavail * s.bsize,
      });
    } catch {
      // Gone, or no permission: leave it out.
    }
  }
  return disks;
}
