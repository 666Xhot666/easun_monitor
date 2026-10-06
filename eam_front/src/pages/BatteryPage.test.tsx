import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import BatteryPage from './BatteryPage';

const device = { id: 3, name: 'House battery', sourceType: 'mac-ble', bluetoothId: null, lastSeenAt: null, createdAt: '', inverterProfileId: 7 };

function renderPage(route: (url: string) => Reply) {
  const server = fakeServer((config) => route(config.url ?? ''));
  render(
    <MemoryRouter initialEntries={['/dashboard/7/battery']}>
      <Routes>
        <Route path="/dashboard/:profileId/battery" element={<BatteryPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return server;
}

describe('BatteryPage', () => {
  let restore = () => {};
  afterEach(() => restore());

  it("shows the BMS's live values and its history", async () => {
    restore = renderPage((url) =>
      url === '/api/inverter/profiles/7/bms'
        ? { status: 200, data: [device] }
        : url === '/api/inverter/profiles/7/bms/3/latest'
          ? {
              status: 200,
              data: {
                status: 'live',
                ageSeconds: 1,
                reading: {
                  timestamp: new Date().toISOString(),
                  stateOfChargePct: 88,
                  packVoltageV: 26.5,
                  currentA: -3,
                  powerW: -79.5,
                  cellVoltagesV: [3.31, 3.32],
                  cellMinIndex: 1,
                  cellMaxIndex: 2,
                  cellDeltaV: 0.01,
                  temperaturesC: [],
                  alarms: [],
                  balancing: false,
                  chargeMosfetOn: true,
                  dischargeMosfetOn: true,
                },
              },
            }
          : { status: 200, data: { source: 'raw', bucketSeconds: 300, points: [] } },
    ).restore;

    expect(await screen.findByRole('heading', { name: 'Battery · House battery' })).toBeInTheDocument();
    expect(await screen.findByTestId('bms-soc')).toHaveTextContent('88%');
    expect(await screen.findByText('No stored BMS readings in this range.')).toBeInTheDocument();
  });

  it('points to the setup when no BMS is configured', async () => {
    restore = renderPage(() => ({ status: 200, data: [] })).restore;

    expect(await screen.findByRole('link', { name: 'Add one in Settings' })).toHaveAttribute('href', '/dashboard/7/settings');
  });
});
