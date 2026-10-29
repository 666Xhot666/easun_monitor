import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import { fakeServer } from '../test/fakeServer';
import ServerPage from './ServerPage';
import type { HostSample, ServerStatus } from './types';

const NOW = Date.parse('2026-10-11T10:00:00Z');
const sample: HostSample = {
  at: new Date(NOW - 20_000).toISOString(),
  uptimeSeconds: 3 * 86_400 + 4 * 3600,
  cpu: { usagePercent: 12.5, coresPercent: [10, 15], load: [0.5, 0.4, 0.3] },
  memory: { totalBytes: 8e9, availableBytes: 3e9, swapTotalBytes: 2e9, swapFreeBytes: 1.5e9 },
  disks: [{ mount: '/', totalBytes: 2.5e11, freeBytes: 1e11 }],
  network: [{ name: 'eth0', rxBytesPerSecond: 1200, txBytesPerSecond: 300 }],
  temperatures: [
    { device: 'coretemp', label: 'Package id 0', celsius: 61 },
    { device: 'coretemp', label: 'Core 0', celsius: 58.5 },
    { device: 'acpitz', label: 'temp1', celsius: 45 },
  ],
  fans: [{ device: 'fanchip', label: 'fan1', rpm: 2509 }],
  services: [
    { name: 'easun-bms-reader', active: true },
    { name: 'easun-outage-reader', active: false },
  ],
  containers: [{ name: 'eam_server', state: 'running', status: 'Up 3 hours' }],
};

function renderPage(status: ServerStatus, role: 'OWNER' | 'VIEWER' = 'OWNER') {
  const server = fakeServer((config) =>
    config.url === '/api/server/history'
      ? { status: 200, data: { bucketSeconds: 300, points: [] } }
      : config.url === '/api/server/alerts'
        ? { status: 200, data: { limits: { heatC: 90, storageFreePercent: 10, memoryUsedPercent: 90 }, events: [] } }
        : config.url === '/api/server/fan'
        ? { status: 200, data: { settings: { mode: 'FIRMWARE', minPercent: 0, manualPercent: 100, rules: [] }, state: null } }
        : { status: 200, data: status },
  );
  const auth = { user: { id: 1, email: 'a@example.com', server: role }, refreshUser: vi.fn() } as unknown as AuthContextValue;
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <ServerPage now={NOW} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return server;
}

const fresh: ServerStatus = { agent: { configured: true, lastSeenAt: sample.at }, sample, stale: false };

describe('ServerPage', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('shows how the host is doing', async () => {
    const server = renderPage(fresh);
    restore = server.restore;

    expect(await screen.findByRole('heading', { name: 'Server' })).toBeInTheDocument();
    expect(server.sent[0].url).toBe('/api/server/status');

    const cpu = screen.getByRole('region', { name: 'CPU' });
    expect(cpu).toHaveTextContent('12.5 %');
    expect(cpu).toHaveTextContent('Load 0.50 · 0.40 · 0.30');

    const temps = screen.getByRole('region', { name: 'Temperatures' });
    expect(temps).toHaveTextContent('61 °C');
    expect(within(temps).getAllByRole('listitem').map((i) => i.textContent)).toEqual([
      'Package id 061 °C',
      'Core 058.5 °C',
      'acpitz45 °C',
    ]);
    expect(screen.getByRole('region', { name: 'Fan' })).toHaveTextContent('2,509 rpm');

    const memory = screen.getByRole('region', { name: 'Memory' });
    expect(memory).toHaveTextContent('5.0 GB of 8.0 GB used');
    expect(memory).toHaveTextContent('Swap 0.5 GB of 2.0 GB');

    expect(screen.getByRole('region', { name: 'Storage' })).toHaveTextContent('/100 GB free of 250 GB');
    expect(screen.getByRole('region', { name: 'Network' })).toHaveTextContent('eth0↓ 1.2 kB/s ↑ 300 B/s');

    const system = screen.getByRole('region', { name: 'System' });
    expect(system).toHaveTextContent('Up 3 d 4 h');
    expect(system).toHaveTextContent('easun-bms-readerrunning');
    expect(system).toHaveTextContent('easun-outage-readerstopped');
    expect(system).toHaveTextContent('eam_serverUp 3 hours');
    expect(screen.getByText('Updated 20 s ago')).toBeInTheDocument();
  });

  it('shows the battery and what each service and container takes', async () => {
    restore = renderPage({
      ...fresh,
      sample: {
        ...sample,
        power: {
          onMains: false,
          batteries: [
            {
              name: 'BAT0',
              model: 'DELL GD1JP65',
              status: 'Discharging',
              percent: 64,
              healthPercent: 39.7,
              nowWh: 17.3,
              fullWh: 27,
              designWh: 68,
              voltageV: 7.9,
              powerW: -7.4,
              cycles: null,
            },
          ],
        },
        services: [
          { name: 'easun-bms-reader', active: true, memoryBytes: 2.2e7, cpuPercent: 0.6, diskBytes: 7.9e9 },
          { name: 'easun-outage-reader', active: false, memoryBytes: null, cpuPercent: null, diskBytes: null },
        ],
        containers: [{ name: 'eam_db', state: 'running', status: 'Up 2 days', memoryBytes: 1.8e8, cpuPercent: 1.25, diskBytes: 9.4e8 }],
      },
    }).restore;

    const battery = await screen.findByRole('region', { name: 'Battery' });
    expect(battery).toHaveTextContent('On battery');
    expect(battery).toHaveTextContent('64 % · discharging, 7.4 W');
    expect(battery).toHaveTextContent('Health 40 %: holds 27 Wh of 68 Wh when new');
    expect(battery).toHaveTextContent('DELL GD1JP65');
    expect(battery).not.toHaveTextContent('cycles');

    const system = screen.getByRole('region', { name: 'System' });
    expect(system).toHaveTextContent('easun-bms-readerrunningRAM 22 MB · CPU 0.6 % · disk 7.9 GB');
    expect(system).toHaveTextContent('eam_dbUp 2 daysRAM 180 MB · CPU 1.3 % · disk 940 MB');
    expect(system).toHaveTextContent('easun-outage-readerstopped');
    expect(system).not.toHaveTextContent('easun-outage-readerstoppedRAM');
  });

  it('shows no battery panel for a host without one', async () => {
    restore = renderPage({ ...fresh, sample: { ...sample, power: { onMains: null, batteries: [] } } }).restore;
    await screen.findByRole('region', { name: 'System' });
    expect(screen.queryByRole('region', { name: 'Battery' })).not.toBeInTheDocument();
  });

  it('shows the package updates waiting, and a restart the system asks for', async () => {
    restore = renderPage({
      ...fresh,
      sample: {
        ...sample,
        updates: {
          checkedAt: new Date(NOW - 2 * 3600_000).toISOString(),
          packages: 12,
          security: 3,
          names: ['openssl', 'snapd'],
          listsUpdatedAt: new Date(NOW - 5 * 3600_000).toISOString(),
          rebootRequired: true,
        },
      },
    }).restore;
    const panel = await screen.findByRole('region', { name: 'Updates' });
    expect(panel).toHaveTextContent('12 packages can be updated, 3 of them security updates.');
    expect(panel).toHaveTextContent('Restart required');
    expect(panel).toHaveTextContent('Checked 2 h ago; package lists from 5 h ago.');
    expect(within(panel).getByText('openssl')).toBeInTheDocument();
  });

  it('says when the system is up to date, or not checked', async () => {
    const upToDate = renderPage({
      ...fresh,
      sample: { ...sample, updates: { checkedAt: sample.at, packages: 0, security: 0, names: [], listsUpdatedAt: null, rebootRequired: false } },
    });
    expect(await screen.findByText('Up to date.')).toBeInTheDocument();
    upToDate.restore();
  });

  it('says when updates are not checked', async () => {
    restore = renderPage(fresh).restore;
    const panel = await screen.findByRole('region', { name: 'Updates' });
    expect(panel).toHaveTextContent('Not checked by the agent.');
  });

  it('says plainly when the agent has gone quiet', async () => {
    restore = renderPage({ ...fresh, sample: { ...sample, at: new Date(NOW - 4 * 60_000).toISOString() }, stale: true }).restore;
    expect(await screen.findByRole('alert')).toHaveTextContent('No report from the agent for 4 min; these values are old.');
  });

  it('tells the owner where to set the agent up, and a viewer that it is not', async () => {
    const none: ServerStatus = { agent: { configured: false, lastSeenAt: null }, sample: null, stale: true };
    const owner = renderPage(none, 'OWNER');
    expect(await screen.findByRole('link', { name: 'Settings › Server access' })).toBeInTheDocument();
    owner.restore();
  });

  it('tells a viewer the agent is not set up', async () => {
    restore = renderPage({ agent: { configured: false, lastSeenAt: null }, sample: null, stale: true }, 'VIEWER').restore;
    expect(await screen.findByText('The server agent is not set up yet.')).toBeInTheDocument();
  });
});
