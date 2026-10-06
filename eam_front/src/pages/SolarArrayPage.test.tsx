import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import type { InverterProfile } from '../auth/types';
import { fakeServer } from '../test/fakeServer';
import SolarArrayPage from './SolarArrayPage';

const profile: InverterProfile = {
  id: 7, name: 'Home', ipAddress: '192.168.1.50', port: 8899, ratedPowerWatts: 3200,
  batteryNominalVoltage: 24, batteryCapacityAh: 100, batteryType: 'LIFEPO4',
  lowBatteryCutoffVoltage: null, bulkChargeVoltage: null, floatChargeVoltage: null,
  pvPanelTypeId: 1, pvPanelsInSeries: 3, pvStrings: 2,
  pvMaxVocV: null, pvMpptMinV: null, pvMpptMaxV: null, pvMaxPowerW: null, pvMaxCurrentA: null,
  createdAt: '', updatedAt: '',
};
const longi = { id: 1, name: 'Longi 450W', maxPowerW: 450, vmpV: 41.5, impA: 10.85, vocV: 49.5, iscA: 11.5 };

describe('SolarArrayPage', () => {
  let restore = () => {};
  afterEach(() => restore());

  it("shows the inverter's array and the panel types, and refreshes the profile after a save", async () => {
    const server = fakeServer((config) =>
      config.url === '/api/panel-types' ? { status: 200, data: [longi] } : { status: 200, data: {} },
    );
    restore = server.restore;
    const refreshUser = vi.fn(async () => {});
    const auth = { user: { id: 1, email: 'a@b.c', createdAt: '', inverterProfiles: [profile] }, refreshUser } as unknown as AuthContextValue;

    render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/dashboard/7/solar']}>
          <Routes>
            <Route path="/dashboard/:profileId/solar" element={<SolarArrayPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(await screen.findByRole('region', { name: 'Array ratings' })).toHaveTextContent('6 panels (3S2P)');
    expect(screen.getByRole('row', { name: /Longi 450W/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save array' }));
    expect(refreshUser).toHaveBeenCalled();
    expect(server.sent.some((c) => c.method === 'patch' && c.url === '/api/inverter/profiles/7')).toBe(true);
  });
});
