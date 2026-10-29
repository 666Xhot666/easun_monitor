import type { Run } from './commands';
import { dockerBytes, readContainerDisk, readServiceDisk } from './storage';

describe('storage', () => {
  it("reads Docker's sizes, which count in thousands", () => {
    expect(dockerBytes('164kB (virtual 1.08GB)')).toBe(164_000);
    expect(dockerBytes('940MB')).toBe(940_000_000);
    expect(dockerBytes('1.5GB')).toBe(1_500_000_000);
    expect(dockerBytes('0B')).toBe(0);
    expect(dockerBytes('N/A')).toBeNull();
  });

  it("gives each container's own layer and the volumes it uses", async () => {
    const run: Run = async (command, args) => {
      expect(command).toBe('docker');
      if (args[0] === 'ps') {
        // Docker shortens long volume names unless told not to.
        expect(args).toContain('--no-trunc');
        return [
          'eam_server\t164kB (virtual 1.08GB)\t/home/u/app/eam_server,app_node_modules',
          'eam_db\t20.5kB (virtual 303MB)\tapp_db_data',
          '',
        ].join('\n');
      }
      return JSON.stringify([
        { Name: 'app_db_data', Size: '940MB' },
        { Name: 'app_node_modules', Size: '300MB' },
        { Name: 'unused', Size: '1GB' },
      ]);
    };
    expect(await readContainerDisk(run)).toEqual(
      new Map([
        ['eam_server', 300_164_000],
        ['eam_db', 940_020_500],
      ]),
    );
  });

  it('gives no container sizes without Docker', async () => {
    const run: Run = () => Promise.reject(new Error('no docker'));
    expect(await readContainerDisk(run)).toEqual(new Map());
  });

  it("gives the size of each unit's working folder, skipping one without", async () => {
    const run: Run = async (command, args) => {
      if (command === 'systemctl') {
        return args.at(-1) === 'easun-bms-reader'
          ? '/home/u/bms/eam_server\n'
          : '\n';
      }
      expect(command).toBe('du');
      return '7932247487\t/home/u/bms/eam_server\n';
    };
    expect(await readServiceDisk(run, ['easun-bms-reader', 'docker'])).toEqual(
      new Map([['easun-bms-reader', 7_932_247_487]]),
    );
  });
});
