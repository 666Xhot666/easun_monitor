import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import type { InverterProfile } from '../auth/types';
import { LiveDataProvider } from '../shell/LiveData';
import { fakeServer } from '../test/fakeServer';
import InverterProfileSettings from './InverterProfileSettings';

const profile: InverterProfile = {
  id: 1, name: 'House', ipAddress: '192.168.1.48', port: 8899, ratedPowerWatts: 6200,
  batteryNominalVoltage: 48, batteryCapacityAh: 200, batteryType: 'LIFEPO4',
  lowBatteryCutoffVoltage: null, bulkChargeVoltage: null, floatChargeVoltage: null,
  pvPanelTypeId: null, pvPanelsInSeries: null, pvStrings: null,
  pvMaxVocV: null, pvMpptMinV: null, pvMpptMaxV: null, pvMaxPowerW: null, pvMaxCurrentA: null,
  householdId: 5, role: 'ADMIN', createdAt: '', updatedAt: '',
};

function renderTab() {
  const server = fakeServer((config) => {
    if (config.url === '/api/inverter/profiles/1' && config.method === 'patch') return { status: 200, data: profile };
    if (config.url === '/api/inverter/pair/test') return { status: 201, data: { success: true, latencyMs: 84, sampledParameter: 'BatteryVoltage' } };
    return { status: 404 };
  });
  const auth = { user: { inverterProfiles: [profile, { ...profile, id: 2 }] }, refreshUser: vi.fn() } as unknown as AuthContextValue;
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <LiveDataProvider profile={profile}>
          <InverterProfileSettings />
        </LiveDataProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { server, auth };
}

describe('InverterProfileSettings', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('shows how EAM reaches the inverter and its battery bank', () => {
    restore = renderTab().server.restore;

    expect(screen.getByLabelText('Name')).toHaveValue('House');
    expect(screen.getByLabelText('Logger IP or hostname')).toHaveValue('192.168.1.48');
    expect(screen.getByLabelText('Port')).toHaveValue(8899);
    expect(screen.getByRole('radio', { name: '6.2 kW' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '48 V' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'LiFePO4' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Capacity (Ah)')).toHaveValue(200);
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  it('saves only what changed and reloads the profile', async () => {
    const { server, auth } = renderTab();
    restore = server.restore;
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Cabin');
    await user.click(screen.getByRole('radio', { name: '24 V' }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    const patch = server.sent.find((c) => c.method === 'patch');
    expect(patch?.url).toBe('/api/inverter/profiles/1');
    expect(JSON.parse(patch?.data)).toEqual({ name: 'Cabin', batteryNominalVoltage: 24 });
    expect(auth.refreshUser).toHaveBeenCalled();
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('takes a custom rated power', async () => {
    const { server } = renderTab();
    restore = server.restore;
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    await user.type(screen.getByLabelText('Rated power (W)'), '4000');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(JSON.parse(server.sent.find((c) => c.method === 'patch')?.data)).toEqual({ ratedPowerWatts: 4000 });
  });

  it('tests the connection to the logger at the address in the form', async () => {
    const { server } = renderTab();
    restore = server.restore;
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Logger IP or hostname'));
    await user.type(screen.getByLabelText('Logger IP or hostname'), '192.168.1.60');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('Connected — read BatteryVoltage in 84 ms.')).toBeInTheDocument();
    expect(JSON.parse(server.sent.find((c) => c.url === '/api/inverter/pair/test')?.data)).toEqual({ ipAddress: '192.168.1.60', port: 8899 });
  });
});
