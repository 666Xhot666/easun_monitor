import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Collector } from './collect';

/** `busy` ticks with 7 idle for every 3 busy: 30 % use between two of them. */
function host(busy: number, rx: number): Record<string, string> {
  const idle = Math.round((busy * 7) / 3);
  return {
    'proc/stat': `cpu  ${busy} 0 0 ${idle} 0 0 0 0\ncpu0 ${busy} 0 0 ${idle} 0 0 0 0\n`,
    'proc/loadavg': '0.50 0.40 0.30 1/100 42\n',
    'proc/uptime': '3600.5 1000\n',
    'proc/meminfo':
      'MemTotal: 8 kB\nMemAvailable: 4 kB\nSwapTotal: 2 kB\nSwapFree: 2 kB\n',
    'proc/net/dev': `h1\nh2\n  eth0: ${rx} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`,
    'proc/mounts': '/dev/sda1 / ext4 rw 0 0\n',
    'sys/class/hwmon/hwmon0/name': 'coretemp\n',
    'sys/class/hwmon/hwmon0/temp1_input': '50000\n',
  };
}

function write(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

describe('Collector', () => {
  it('reads the whole host, with use and traffic since the previous reading', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-'));
    write(dir, host(100, 0));
    const collector = new Collector({
      root: dir,
      services: ['easun-x'],
      run: (command) =>
        command === 'systemctl'
          ? Promise.resolve('active\n')
          : Promise.reject(new Error('no docker')),
      statfs: () => ({ bsize: 1024, blocks: 100, bavail: 40 }),
    });

    const first = await collector.sample(new Date('2026-10-11T10:00:00Z'));
    expect(first).toEqual({
      at: '2026-10-11T10:00:00.000Z',
      uptimeSeconds: 3600,
      cpu: { usagePercent: null, coresPercent: [], load: [0.5, 0.4, 0.3] },
      memory: {
        totalBytes: 8192,
        availableBytes: 4096,
        swapTotalBytes: 2048,
        swapFreeBytes: 2048,
      },
      disks: [{ mount: '/', totalBytes: 102400, freeBytes: 40960 }],
      network: [
        { name: 'eth0', rxBytesPerSecond: null, txBytesPerSecond: null },
      ],
      temperatures: [{ device: 'coretemp', label: 'temp1', celsius: 50 }],
      fans: [],
      services: [{ name: 'easun-x', active: true }],
      containers: null,
    });

    write(dir, host(400, 6000));
    const second = await collector.sample(new Date('2026-10-11T10:01:00Z'));
    expect(second.cpu.usagePercent).toBe(30);
    expect(second.network).toEqual([
      { name: 'eth0', rxBytesPerSecond: 100, txBytesPerSecond: 0 },
    ]);
  });

  it('checks for package updates every so often, and gives the last result in between', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-'));
    write(dir, host(100, 0));
    let asked = 0;
    const collector = new Collector({
      root: dir,
      services: [],
      run: (command) => {
        if (command !== 'apt') return Promise.reject(new Error('no'));
        asked++;
        return Promise.resolve(
          `Listing...\npkg${asked}/noble-security 1 amd64 [upgradable from: 0]\n`,
        );
      },
      statfs: () => ({ bsize: 1, blocks: 1, bavail: 1 }),
      updatesEveryMs: 60 * 60_000,
    });
    const at = (minutes: number) =>
      new Date(Date.parse('2026-10-11T10:00:00Z') + minutes * 60_000);

    expect((await collector.sample(at(0))).updates).toMatchObject({
      names: ['pkg1'],
      security: 1,
    });
    expect((await collector.sample(at(30))).updates).toMatchObject({
      names: ['pkg1'],
    });
    expect((await collector.sample(at(60))).updates).toMatchObject({
      names: ['pkg2'],
    });
    expect(asked).toBe(2);
  });
});
