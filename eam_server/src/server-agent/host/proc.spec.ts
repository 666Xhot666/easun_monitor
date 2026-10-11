import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  cpuUsage,
  netRates,
  readCpuTimes,
  readLoad,
  readMemory,
  readNetCounters,
  readUptime,
} from './proc';

/** A fake root with the given files. */
function root(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'host-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const STAT = (busy: number, idle: number) =>
  [
    `cpu  ${busy * 2} 0 0 ${idle * 2} 0 0 0 0 0 0`,
    `cpu0 ${busy} 0 0 ${idle} 0 0 0 0 0 0`,
    `cpu1 ${busy} 0 0 ${idle} 0 0 0 0 0 0`,
    'intr 12345',
    'ctxt 678',
  ].join('\n');

describe('/proc readers', () => {
  it('reads CPU times, and the use between two readings', () => {
    const before = readCpuTimes(root({ 'proc/stat': STAT(100, 900) }));
    expect(before).toEqual({
      total: { busy: 200, idle: 1800 },
      cores: [
        { busy: 100, idle: 900 },
        { busy: 100, idle: 900 },
      ],
    });
    const after = readCpuTimes(root({ 'proc/stat': STAT(130, 970) }));
    // Each core: 30 busy of 100 ticks.
    expect(cpuUsage(before, after)).toEqual({
      usagePercent: 30,
      coresPercent: [30, 30],
    });
  });

  it('counts iowait as idle and irq, softirq and steal as busy', () => {
    const t = (user: number, iowait: number, irq: number) =>
      readCpuTimes(
        root({
          'proc/stat': `cpu  ${user} 0 0 100 ${iowait} ${irq} 0 0 0 0\ncpu0 ${user} 0 0 100 ${iowait} ${irq} 0 0 0 0\n`,
        }),
      );
    expect(t(10, 5, 2).total).toEqual({ busy: 12, idle: 105 });
  });

  it('reads the load, uptime and memory', () => {
    const dir = root({
      'proc/loadavg': '0.52 0.61 0.70 2/345 6789\n',
      'proc/uptime': '86461.25 300000.00\n',
      'proc/meminfo': [
        'MemTotal:        8000000 kB',
        'MemFree:          500000 kB',
        'MemAvailable:    3000000 kB',
        'SwapTotal:       2000000 kB',
        'SwapFree:        1500000 kB',
      ].join('\n'),
    });
    expect(readLoad(dir)).toEqual([0.52, 0.61, 0.7]);
    expect(readUptime(dir)).toBe(86461);
    expect(readMemory(dir)).toEqual({
      totalBytes: 8000000 * 1024,
      availableBytes: 3000000 * 1024,
      swapTotalBytes: 2000000 * 1024,
      swapFreeBytes: 1500000 * 1024,
    });
  });

  it("reads the network interfaces' counters, leaving out loopback and Docker's", () => {
    const dev = (rx: number, tx: number) =>
      [
        'Inter-|   Receive                                                |  Transmit',
        ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
        `    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0`,
        `  eth0: ${rx} 10 0 0 0 0 0 0 ${tx} 10 0 0 0 0 0 0`,
        `wlan0: 5 1 0 0 0 0 0 0 6 1 0 0 0 0 0 0`,
        `docker0: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0`,
        `br-1a2b: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0`,
        `veth12ab: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0`,
      ].join('\n');
    const before = readNetCounters(root({ 'proc/net/dev': dev(1000, 2000) }));
    expect(before).toEqual([
      { name: 'eth0', rxBytes: 1000, txBytes: 2000 },
      { name: 'wlan0', rxBytes: 5, txBytes: 6 },
    ]);
    const after = readNetCounters(root({ 'proc/net/dev': dev(7000, 5000) }));
    expect(netRates(before, after, 60)).toEqual([
      { name: 'eth0', rxBytesPerSecond: 100, txBytesPerSecond: 50 },
      { name: 'wlan0', rxBytesPerSecond: 0, txBytesPerSecond: 0 },
    ]);
  });

  it('keeps only interfaces backed by a device when the kernel says which are', () => {
    const dev = [
      'h1',
      'h2',
      '  eth0: 1 0 0 0 0 0 0 0 2 0 0 0 0 0 0 0',
      'wlan0: 3 0 0 0 0 0 0 0 4 0 0 0 0 0 0 0',
      'tunl0: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      'gre0: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
    ].join('\n');
    const dir = root({
      'proc/net/dev': dev,
      'sys/class/net/eth0/device/vendor': '0x10ec\n',
      'sys/class/net/wlan0/device/vendor': '0x14e4\n',
      'sys/class/net/tunl0/type': '768\n',
      'sys/class/net/gre0/type': '778\n',
    });
    expect(readNetCounters(dir).map((n) => n.name)).toEqual(['eth0', 'wlan0']);
  });

  it('gives no rate for an interface that is new or whose counter went back', () => {
    expect(
      netRates(
        [{ name: 'eth0', rxBytes: 9000, txBytes: 10 }],
        [
          { name: 'eth0', rxBytes: 100, txBytes: 70 },
          { name: 'wlan0', rxBytes: 5, txBytes: 6 },
        ],
        60,
      ),
    ).toEqual([
      { name: 'eth0', rxBytesPerSecond: null, txBytesPerSecond: 1 },
      { name: 'wlan0', rxBytesPerSecond: null, txBytesPerSecond: null },
    ]);
  });
});
