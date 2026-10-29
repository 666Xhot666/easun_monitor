import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  cgroupCpuPercent,
  readCgroup,
  serviceCgroup,
  containerCgroup,
} from './cgroups';

function root(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cgroup-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const slice = 'sys/fs/cgroup/system.slice';

describe('cgroups', () => {
  it('names the cgroup of a systemd unit and of a Docker container', () => {
    expect(serviceCgroup('easun-serial-logger')).toBe(
      'system.slice/easun-serial-logger.service',
    );
    expect(serviceCgroup('docker.socket')).toBe('system.slice/docker.socket');
    expect(containerCgroup('ea73a7e0')).toBe(
      'system.slice/docker-ea73a7e0.scope',
    );
  });

  it("reads a cgroup's memory, without the page cache it can drop, and its CPU time", () => {
    const dir = root({
      [`${slice}/easun-serial-logger.service/memory.current`]: '23261184\n',
      [`${slice}/easun-serial-logger.service/memory.stat`]:
        'anon 21667840\nfile 1593344\ninactive_file 1000000\nactive_file 593344\n',
      [`${slice}/easun-serial-logger.service/cpu.stat`]:
        'usage_usec 16639335\nuser_usec 11919201\nsystem_usec 4720133\n',
    });
    expect(readCgroup(dir, 'system.slice/easun-serial-logger.service')).toEqual(
      {
        memoryBytes: 22261184,
        cpuUsec: 16639335,
      },
    );
  });

  it('gives null for a cgroup that is not there: a stopped unit', () => {
    expect(readCgroup(root({}), 'system.slice/gone.service')).toBeNull();
  });

  it('gives CPU use since the previous reading, as a share of one core', () => {
    const before = { memoryBytes: 0, cpuUsec: 1_000_000 };
    const after = { memoryBytes: 0, cpuUsec: 4_000_000 };
    expect(cgroupCpuPercent(before, after, 30)).toBe(10);
    expect(cgroupCpuPercent(null, after, 30)).toBeNull();
    // Restarted in between: its counter began again.
    expect(cgroupCpuPercent(after, before, 30)).toBeNull();
  });
});
