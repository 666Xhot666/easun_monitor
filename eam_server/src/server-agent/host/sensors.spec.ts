import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readDisks, readMounts } from './disks';
import { readSensors } from './sensors';

function root(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'host-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe('readSensors', () => {
  it('reads every temperature and fan the kernel exposes, by device name and label', () => {
    const dir = root({
      'sys/class/hwmon/hwmon1/name': 'acpitz\n',
      'sys/class/hwmon/hwmon1/temp1_input': '45000\n',
      'sys/class/hwmon/hwmon5/name': 'coretemp\n',
      'sys/class/hwmon/hwmon5/temp1_input': '61000\n',
      'sys/class/hwmon/hwmon5/temp1_label': 'Package id 0\n',
      'sys/class/hwmon/hwmon5/temp2_input': '58500\n',
      'sys/class/hwmon/hwmon5/temp2_label': 'Core 0\n',
      'sys/class/hwmon/hwmon5/temp2_max': '100000\n',
      'sys/class/hwmon/hwmon6/name': 'fanchip\n',
      'sys/class/hwmon/hwmon6/fan1_input': '2509\n',
      'sys/class/hwmon/hwmon6/pwm1': '128\n',
    });
    expect(readSensors(dir)).toEqual({
      temperatures: [
        { device: 'acpitz', label: 'temp1', celsius: 45 },
        { device: 'coretemp', label: 'Package id 0', celsius: 61 },
        { device: 'coretemp', label: 'Core 0', celsius: 58.5 },
      ],
      fans: [{ device: 'fanchip', label: 'fan1', rpm: 2509 }],
    });
  });

  it('skips a sensor that cannot be read, and a host without any', () => {
    const dir = root({
      'sys/class/hwmon/hwmon0/name': 'battery\n',
      'sys/class/hwmon/hwmon0/temp1_input': 'oops\n',
    });
    expect(readSensors(dir)).toEqual({ temperatures: [], fans: [] });
    expect(readSensors(root({}))).toEqual({ temperatures: [], fans: [] });
  });
});

describe('disks', () => {
  const MOUNTS = [
    'sysfs /sys sysfs rw 0 0',
    '/dev/mapper/vg-root / ext4 rw,relatime 0 0',
    '/dev/nvme0n1p2 /boot ext4 rw 0 0',
    '/dev/nvme0n1p1 /boot/efi vfat rw 0 0',
    'overlay /var/lib/docker/overlay2/abc/merged overlay rw 0 0',
    'tmpfs /run tmpfs rw 0 0',
    '/dev/mapper/vg-root /var/lib/docker/bind ext4 rw 0 0',
    '/dev/sdb1 /mnt/my\\040disk ext4 rw 0 0',
  ].join('\n');

  it('lists the real filesystems, each device once', () => {
    expect(readMounts(root({ 'proc/mounts': MOUNTS }))).toEqual([
      '/',
      '/boot',
      '/boot/efi',
      '/mnt/my disk',
    ]);
  });

  it('gives the size and free space of each', () => {
    const dir = root({ 'proc/mounts': MOUNTS });
    const statfs = (path: string) => {
      const blocks: Record<string, [number, number]> = {
        '/': [1000, 250],
        '/boot': [100, 50],
        '/boot/efi': [10, 9],
      };
      const found = blocks[path.slice(dir.length) || '/'];
      if (!found) throw new Error('ENOENT');
      return { bsize: 4096, blocks: found[0], bavail: found[1] };
    };
    expect(readDisks(dir, statfs)).toEqual([
      { mount: '/', totalBytes: 4096000, freeBytes: 1024000 },
      { mount: '/boot', totalBytes: 409600, freeBytes: 204800 },
      { mount: '/boot/efi', totalBytes: 40960, freeBytes: 36864 },
    ]);
  });
});
