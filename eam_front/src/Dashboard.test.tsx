import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from './auth/context';
import type { HouseholdRole, InverterProfile } from './auth/types';
import Dashboard from './Dashboard';
import { fakeServer } from './test/fakeServer';

const profile = (id: number, role: HouseholdRole): InverterProfile => ({
  id, name: `Inverter ${id}`, ipAddress: `192.168.1.${id}`, port: 8899, ratedPowerWatts: 3200,
  batteryNominalVoltage: 24, batteryCapacityAh: 100, batteryType: 'LIFEPO4',
  lowBatteryCutoffVoltage: null, bulkChargeVoltage: null, floatChargeVoltage: null,
  pvPanelTypeId: null, pvPanelsInSeries: null, pvStrings: null,
  pvMaxVocV: null, pvMpptMinV: null, pvMpptMaxV: null, pvMaxPowerW: null, pvMaxCurrentA: null,
  householdId: 1, role, createdAt: '', updatedAt: '',
});

const faultMode = [{ name: 'OperationMode', label: 'Operating mode', address: 201, type: 'uint16', group: 'telemetry', options: ['Power on', 'Standby', 'Mains', 'Off-grid', 'Bypass', 'Charging', 'Fault'] }];

function renderDashboard(role: HouseholdRole, adminHouseholdId: number | null) {
  const restore = fakeServer((config) =>
    config.url === '/api/inverter/registers'
      ? { status: 200, data: faultMode }
      : config.url === '/api/inverter/1/latest'
        ? { status: 200, data: { id: 1, timestamp: new Date().toISOString(), payload: { OperationMode: 6 } } }
        : { status: 404 },
  ).restore;
  const auth = {
    user: { id: 1, email: 'me@example.com', createdAt: '', adminHouseholdId, households: [], inverterProfiles: [profile(1, role), profile(2, role)] },
    logout: vi.fn(),
    logoutEverywhere: vi.fn(),
    refreshUser: vi.fn(),
  } as unknown as AuthContextValue;
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/dashboard/1']}>
        <Routes>
          <Route path="/dashboard/:profileId" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return restore;
}

describe('Dashboard', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('offers an admin adding and removing inverters, and clearing a fault', async () => {
    restore = renderDashboard('ADMIN', 1);

    expect(await screen.findByRole('button', { name: 'Exit fault mode' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Add inverter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Inverter 1' })).toBeInTheDocument();
  });

  it('shows a reader everything but offers no changes', async () => {
    restore = renderDashboard('READER', null);

    expect(await screen.findByText('The inverter is in fault mode.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exit fault mode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '+ Add inverter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Inverter 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings/ })).toBeInTheDocument();
  });
});
