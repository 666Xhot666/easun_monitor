import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import type { HouseholdRole, InverterProfile } from '../auth/types';
import { LiveDataProvider } from '../shell/LiveData';
import { fakeServer } from '../test/fakeServer';
import { ThemeProvider } from '../theme/useTheme';
import SettingsPage from './SettingsPage';

const profile = (id: number, role: HouseholdRole): InverterProfile => ({
  id, name: id === 1 ? 'House' : 'Workshop', ipAddress: '192.168.1.48', port: 8899, ratedPowerWatts: 6200,
  batteryNominalVoltage: 48, batteryCapacityAh: 200, batteryType: 'LIFEPO4',
  lowBatteryCutoffVoltage: null, bulkChargeVoltage: null, floatChargeVoltage: null,
  pvPanelTypeId: null, pvPanelsInSeries: null, pvStrings: null,
  pvMaxVocV: null, pvMpptMinV: null, pvMpptMaxV: null, pvMaxPowerW: null, pvMaxCurrentA: null,
  householdId: 5, role, createdAt: '', updatedAt: '',
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderSettings(role: HouseholdRole, path: string) {
  const server = fakeServer((config) => {
    if (config.url === '/api/inverter/profiles/1' && config.method === 'delete') return { status: 200 };
    if (config.url === '/api/inverter/profiles/1/bms') return { status: 200, data: [] };
    if (config.url === '/api/telegram/link') return { status: 200, data: { linked: false } };
    return { status: 404 };
  });
  const profiles = [profile(1, role), profile(2, role)];
  const auth = {
    user: {
      id: 1, email: 'jack@example.com', createdAt: '', adminHouseholdId: role === 'ADMIN' ? 5 : null,
      households: [{ id: 5, name: 'Home', role }],
      inverterProfiles: profiles,
    },
    logoutEverywhere: vi.fn(),
    refreshUser: vi.fn(),
  } as unknown as AuthContextValue;
  render(
    <ThemeProvider>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/dashboard/:profileId/settings/:tab?"
              element={
                <LiveDataProvider profile={profiles[0]}>
                  <SettingsPage />
                </LiveDataProvider>
              }
            />
            <Route path="*" element={null} />
          </Routes>
          <Where />
        </MemoryRouter>
      </AuthContext.Provider>
    </ThemeProvider>,
  );
  return { server, auth };
}

describe('SettingsPage', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('gives an admin one tab per area, opening on the inverter', () => {
    restore = renderSettings('ADMIN', '/dashboard/1/settings').server.restore;

    const tabs = within(screen.getByRole('navigation', { name: 'Settings' })).getAllByRole('link');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Inverter', 'Inverter settings', 'Solar array', 'Battery monitor', 'Household', 'Notifications', 'Account',
    ]);
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/1/settings/inverter');
    expect(screen.getByText('192.168.1.48 : 8899')).toBeInTheDocument();
  });

  it('gives a reader the configuration to look at and their own settings only', () => {
    restore = renderSettings('READER', '/dashboard/1/settings/solar').server.restore;

    const tabs = within(screen.getByRole('navigation', { name: 'Settings' })).getAllByRole('link');
    expect(tabs.map((t) => t.textContent)).toEqual(['Current configuration', 'Household', 'Notifications', 'Account']);
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/1/settings/configuration');
  });

  it('removes an inverter only after confirming', async () => {
    const { server, auth } = renderSettings('ADMIN', '/dashboard/1/settings/inverter');
    restore = server.restore;
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Remove House…' }));
    expect(server.sent.some((c) => c.method === 'delete')).toBe(false);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove inverter' }));

    expect(server.sent.some((c) => c.method === 'delete' && c.url === '/api/inverter/profiles/1')).toBe(true);
    expect(auth.refreshUser).toHaveBeenCalled();
  });

  it('keeps the battery monitor and Telegram in their own tabs', async () => {
    restore = renderSettings('ADMIN', '/dashboard/1/settings/battery-monitor').server.restore;
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Battery monitor (BMS)' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Notifications' }));
    expect(await screen.findByRole('button', { name: 'Get a link code' })).toBeInTheDocument();
  });

  it('switches the theme from the account tab', async () => {
    restore = renderSettings('ADMIN', '/dashboard/1/settings/account').server.restore;
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
