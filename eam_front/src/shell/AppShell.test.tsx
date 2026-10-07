import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import type { HouseholdRole, InverterProfile } from '../auth/types';
import { fakeServer } from '../test/fakeServer';
import { ThemeProvider } from '../theme/useTheme';
import AppShell from './AppShell';

const profile = (id: number, name: string, role: HouseholdRole): InverterProfile => ({
  id, name, ipAddress: `192.168.1.${id}`, port: 8899, ratedPowerWatts: 6200,
  batteryNominalVoltage: 48, batteryCapacityAh: 200, batteryType: 'LIFEPO4',
  lowBatteryCutoffVoltage: null, bulkChargeVoltage: null, floatChargeVoltage: null,
  pvPanelTypeId: null, pvPanelsInSeries: null, pvStrings: null,
  pvMaxVocV: null, pvMpptMinV: null, pvMpptMaxV: null, pvMaxPowerW: null, pvMaxCurrentA: null,
  householdId: 5, role, createdAt: '', updatedAt: '',
});

const modeRegister = [{ name: 'OperationMode', label: 'Operating mode', address: 201, type: 'uint16', group: 'telemetry', options: ['Power on', 'Standby', 'Mains', 'Off-grid', 'Bypass', 'Charging', 'Fault'] }];

type Scenario = { mode?: number; ageMs?: number; device?: 'online' | 'backoff'; gridInApp?: boolean };

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderShell(role: HouseholdRole, scenario: Scenario = {}, path = '/dashboard/1') {
  const { mode = 3, ageMs = 1000, device = 'online', gridInApp = true } = scenario;
  const server = fakeServer((config) => {
    if (config.url === '/api/inverter/registers') return { status: 200, data: modeRegister };
    if (config.url === '/api/inverter/1/latest') {
      return { status: 200, data: { id: 1, timestamp: new Date(Date.now() - ageMs).toISOString(), payload: { OperationMode: mode } } };
    }
    if (config.url === '/api/inverter/1/status') {
      return { status: 200, data: { state: device, lastSuccessAt: null, lastError: device === 'online' ? null : 'timeout', retryAt: null } };
    }
    if (config.url === '/api/inverter/1/exit-fault-mode') return { status: 201 };
    if (config.url === '/api/notifications/settings') {
      return { status: 200, data: { channels: { grid: { inApp: gridInApp, telegram: true } }, quietHours: false } };
    }
    if (config.url === '/api/inverter/1/alerts') {
      return { status: 200, data: [
        { id: 9, kind: 'grid', text: 'Grid restored', source: null, at: new Date().toISOString() },
        { id: 8, kind: 'grid', text: 'Grid lost', source: null, at: new Date().toISOString() },
      ] };
    }
    return { status: 404 };
  });
  const auth = {
    user: {
      id: 1, email: 'jack@example.com', createdAt: '', adminHouseholdId: role === 'ADMIN' ? 5 : null,
      households: [{ id: 5, name: 'Home', role }],
      inverterProfiles: [profile(1, 'House', role), profile(2, 'Workshop', role)],
    },
    logout: vi.fn(),
    logoutEverywhere: vi.fn(),
    refreshUser: vi.fn(),
  } as unknown as AuthContextValue;
  render(
    <ThemeProvider>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/dashboard/:profileId" element={<AppShell />}>
              <Route index element={<p>Overview page</p>} />
              <Route path="battery" element={<p>Battery page</p>} />
              <Route path="settings/*" element={<p>Settings page</p>} />
            </Route>
            <Route path="*" element={<Where />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </AuthContext.Provider>
    </ThemeProvider>,
  );
  return { server, auth };
}

describe('AppShell', () => {
  let restore = () => {};
  afterEach(() => {
    restore();
    localStorage.clear();
  });

  it('counts the alerts not yet seen on the bell, which opens the Alerts page', async () => {
    localStorage.setItem('eam.alerts.seen.1', '8');
    restore = renderShell('ADMIN').server.restore;
    const user = userEvent.setup();

    const bell = await screen.findByRole('link', { name: 'Notifications, 1 unread' });
    expect(bell).toHaveAttribute('href', '/dashboard/1/alerts');
    await user.click(bell);
    expect(screen.getAllByTestId('where')[0]).toHaveTextContent('/dashboard/1/alerts');
  });

  it('leaves kinds switched off in the app out of the bell', async () => {
    const { server } = renderShell('ADMIN', { gridInApp: false });
    restore = server.restore;

    await waitFor(() =>
      expect(server.sent.map((c) => c.url)).toEqual(expect.arrayContaining(['/api/inverter/1/alerts', '/api/notifications/settings'])),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('shows a quiet bell when everything has been seen', async () => {
    localStorage.setItem('eam.alerts.seen.1', '9');
    restore = renderShell('ADMIN').server.restore;

    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('shows the page inside the shell with the five destinations', async () => {
    restore = renderShell('ADMIN').server.restore;

    expect(await screen.findByText('Overview page')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const [name, href] of [
      ['Overview', '/dashboard/1'],
      ['Battery', '/dashboard/1/battery'],
      ['History', '/dashboard/1/history'],
      ['Alerts', '/dashboard/1/alerts'],
      ['Settings', '/dashboard/1/settings'],
    ]) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href);
    }
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('navigation', { name: 'Main (phone)' })).toBeInTheDocument();
    expect(screen.getByText('Home · Admin')).toBeInTheDocument();
  });

  it('switches inverters, keeping the page, and offers adding one to an admin', async () => {
    restore = renderShell('ADMIN', {}, '/dashboard/1/battery').server.restore;
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /House/ }));
    expect(screen.getByRole('menuitem', { name: /Add inverter/ })).toHaveAttribute('href', '/setup');
    await user.click(screen.getByRole('menuitem', { name: /Workshop/ }));

    expect(screen.getAllByTestId('where')[0]).toHaveTextContent('/dashboard/2/battery');
  });

  it('offers a reader no inverter to add', async () => {
    restore = renderShell('READER').server.restore;
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /House/ }));
    expect(screen.queryByRole('menuitem', { name: /Add inverter/ })).not.toBeInTheDocument();
    expect(screen.getByText('Home · Reader')).toBeInTheDocument();
  });

  it('shows a live system as live', async () => {
    restore = renderShell('ADMIN').server.restore;

    expect(await screen.findByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/Updated \d+ s ago/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a fault on every page, and lets an admin clear it after confirming', async () => {
    const { server } = renderShell('ADMIN', { mode: 6 });
    restore = server.restore;
    const user = userEvent.setup();

    expect(await screen.findByText('Fault')).toBeInTheDocument();
    const banner = screen.getByRole('alert');
    expect(within(banner).getByText('Fault: the inverter is in fault mode')).toBeInTheDocument();
    await user.click(within(banner).getByRole('button', { name: 'Exit fault mode' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Exit fault mode' }));

    expect(server.sent.some((c) => c.method === 'post' && c.url === '/api/inverter/1/exit-fault-mode')).toBe(true);
  });

  it('shows a reader the fault without the button to clear it', async () => {
    restore = renderShell('READER', { mode: 6 }).server.restore;

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exit fault mode' })).not.toBeInTheDocument();
  });

  it('says when readings stopped although the logger answers', async () => {
    restore = renderShell('ADMIN', { ageMs: 5.5 * 60_000 }).server.restore;

    expect(await screen.findByText('Stale')).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByText(/No new readings for 5 min/)).toBeInTheDocument();
  });

  it('says when the logger cannot be reached', async () => {
    restore = renderShell('ADMIN', { device: 'backoff' }).server.restore;

    expect(await screen.findByText('Offline')).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByText(/Can’t reach the inverter logger/)).toBeInTheDocument();
  });

  it('signs out from the account menu, and everywhere only after confirming', async () => {
    const { server, auth } = renderShell('ADMIN');
    restore = server.restore;
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menuitem', { name: 'Account settings' })).toHaveAttribute('href', '/dashboard/1/settings/account');
    await user.click(screen.getByRole('menuitem', { name: 'Sign out everywhere…' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out everywhere' }));
    expect(auth.logoutEverywhere).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(auth.logout).toHaveBeenCalled();
  });
});
