import { execFile } from 'node:child_process';

/** Runs a command, resolving with its output even when it exits non-zero. */
export type Run = (command: string, args: string[]) => Promise<string>;

export const run: Run = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10_000 }, (error, stdout) => {
      // `systemctl is-active` exits 3 when a unit is not running.
      if (error && !stdout) reject(error);
      else resolve(stdout);
    });
  });

export interface Service {
  name: string;
  active: boolean;
}

/** Whether each systemd unit is running; null when systemd cannot be asked. */
export async function readServices(
  runCommand: Run,
  names: string[],
): Promise<Service[] | null> {
  if (names.length === 0) return [];
  try {
    const states = (await runCommand('systemctl', ['is-active', ...names]))
      .trim()
      .split('\n');
    return names.map((name, i) => ({ name, active: states[i] === 'active' }));
  } catch {
    return null;
  }
}

export interface Container {
  /** Docker's full id, which names the container's cgroup. */
  id: string;
  name: string;
  /** running, exited, restarting, ... */
  state: string;
  /** Docker's own words, e.g. "Up 3 hours (healthy)". */
  status: string;
}

/** Docker's containers; null without Docker or permission to ask it. */
export async function readContainers(
  runCommand: Run,
): Promise<Container[] | null> {
  try {
    const out = await runCommand('docker', [
      'ps',
      '-a',
      '--no-trunc',
      '--format',
      '{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Status}}',
    ]);
    return out
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [id, name, state, status] = line.split('\t');
        return { id, name, state, status: status ?? '' };
      });
  } catch {
    return null;
  }
}
