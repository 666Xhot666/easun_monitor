import { readContainers, readServices, type Run } from './commands';

const answering =
  (outputs: Record<string, string | Error>): Run =>
  (command, args) => {
    const out = outputs[[command, ...args].join(' ')];
    return out instanceof Error || out === undefined
      ? Promise.reject(out ?? new Error('not found'))
      : Promise.resolve(out);
  };

describe('readServices', () => {
  it('says which of the services are running', async () => {
    const run = answering({
      'systemctl is-active easun-serial-logger easun-bms-reader':
        'active\nfailed\n',
    });
    expect(
      await readServices(run, ['easun-serial-logger', 'easun-bms-reader']),
    ).toEqual([
      { name: 'easun-serial-logger', active: true },
      { name: 'easun-bms-reader', active: false },
    ]);
  });

  it('gives none without systemd, or when none are named', async () => {
    expect(await readServices(answering({}), ['easun-x'])).toBeNull();
    expect(await readServices(answering({}), [])).toEqual([]);
  });
});

describe('readContainers', () => {
  it("lists Docker's containers with their state", async () => {
    const run = answering({
      'docker ps -a --no-trunc --format {{.ID}}\t{{.Names}}\t{{.State}}\t{{.Status}}':
        'a1\team_server\trunning\tUp 3 hours\nb2\team_db\trunning\tUp 3 hours (healthy)\nc3\told\texited\tExited (0) 2 days ago\n',
    });
    expect(await readContainers(run)).toEqual([
      { id: 'a1', name: 'eam_server', state: 'running', status: 'Up 3 hours' },
      {
        id: 'b2',
        name: 'eam_db',
        state: 'running',
        status: 'Up 3 hours (healthy)',
      },
      {
        id: 'c3',
        name: 'old',
        state: 'exited',
        status: 'Exited (0) 2 days ago',
      },
    ]);
  });

  it('gives none without Docker or its permission', async () => {
    expect(await readContainers(answering({}))).toBeNull();
  });
});
