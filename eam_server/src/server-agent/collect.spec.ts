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
      power: { onMains: null, batteries: [] },
      services: [
        {
          name: 'easun-x',
          active: true,
          memoryBytes: null,
          cpuPercent: null,
          diskBytes: null,
        },
      ],
      containers: null,
    });

    write(dir, host(400, 6000));
    const second = await collector.sample(new Date('2026-10-11T10:01:00Z'));
    expect(second.cpu.usagePercent).toBe(30);
    expect(second.network).toEqual([
      { name: 'eth0', rxBytesPerSecond: 100, txBytesPerSecond: 0 },
    ]);
  });

  it('gives what each service and container takes: memory and CPU each time, disk every so often', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-'));
    const cgroups = (serviceUsec: number, dbUsec: number) => ({
      'sys/fs/cgroup/system.slice/easun-x.service/memory.current': '3000\n',
      'sys/fs/cgroup/system.slice/easun-x.service/memory.stat':
        'inactive_file 1000\n',
      'sys/fs/cgroup/system.slice/easun-x.service/cpu.stat': `usage_usec ${serviceUsec}\n`,
      'sys/fs/cgroup/system.slice/docker-d1.scope/memory.current': '9000\n',
      'sys/fs/cgroup/system.slice/docker-d1.scope/memory.stat': '\n',
      'sys/fs/cgroup/system.slice/docker-d1.scope/cpu.stat': `usage_usec ${dbUsec}\n`,
    });
    write(dir, { ...host(100, 0), ...cgroups(0, 0) });
    write(dir, {
      'sys/class/power_supply/AC/type': 'Mains\n',
      'sys/class/power_supply/AC/online': '1\n',
    });
    let measured = 0;
    const collector = new Collector({
      root: dir,
      services: ['easun-x'],
      run: (command, args) => {
        if (command === 'systemctl' && args[0] === 'is-active')
          return Promise.resolve('active\n');
        if (command === 'systemctl') return Promise.resolve('/srv/x\n');
        if (command === 'du') {
          measured++;
          return Promise.resolve(`${measured * 100}\t/srv/x\n`);
        }
        if (args.includes('--size'))
          return Promise.resolve('eam_db\t1kB\tdb_data\n');
        if (args[0] === 'system')
          return Promise.resolve('[{"Name":"db_data","Size":"2MB"}]');
        return Promise.resolve('d1\team_db\trunning\tUp 1 hour\n');
      },
      statfs: () => ({ bsize: 1, blocks: 1, bavail: 1 }),
      diskEveryMs: 10 * 60_000,
    });
    const at = (minutes: number) =>
      new Date(Date.parse('2026-10-11T10:00:00Z') + minutes * 60_000);

    const first = await collector.sample(at(0));
    expect(first.power).toEqual({ onMains: true, batteries: [] });
    expect(first.services).toEqual([
      {
        name: 'easun-x',
        active: true,
        memoryBytes: 2000,
        cpuPercent: null,
        diskBytes: 100,
      },
    ]);
    expect(first.containers).toEqual([
      {
        name: 'eam_db',
        state: 'running',
        status: 'Up 1 hour',
        memoryBytes: 9000,
        cpuPercent: null,
        diskBytes: 2_001_000,
      },
    ]);

    write(dir, cgroups(6_000_000, 30_000_000));
    const second = await collector.sample(at(1));
    expect(second.services?.[0]).toMatchObject({
      cpuPercent: 10,
      diskBytes: 100,
    });
    expect(second.containers?.[0]).toMatchObject({ cpuPercent: 50 });

    expect((await collector.sample(at(10))).services?.[0].diskBytes).toBe(200);
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
