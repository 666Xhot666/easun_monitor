import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { InverterProfile } from '../auth/types';
import type { RegisterDefinition } from '../inverter/types';
import { LiveDataProvider } from '../shell/LiveData';
import { fakeServer } from '../test/fakeServer';
import HistoryPage from './HistoryPage';

const registers: RegisterDefinition[] = [
  { name: 'PVPower', label: 'PV power', address: 223, type: 'int16', unit: 'W', group: 'telemetry' },
  { name: 'OutputPriority', label: 'Output priority', address: 301, type: 'uint16', group: 'settings', writable: true, options: ['UTI', 'SOL', 'SBU'] },
];
const profile = { id: 7, name: 'House', role: 'ADMIN' } as InverterProfile;

describe('HistoryPage', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('opens on power, offers daily energy and the readings, and exports from a dialog', async () => {
    restore = fakeServer((config) =>
      config.url === '/api/inverter/registers'
        ? { status: 200, data: registers }
        : config.url === '/api/inverter/7/readings'
          ? { status: 200, data: [{ id: 1, timestamp: new Date().toISOString(), payload: { PVPower: 278, OutputPriority: 2 } }] }
          : config.url === '/api/inverter/7/history'
            ? { status: 200, data: { source: 'raw', bucketSeconds: 300, points: [] } }
            : { status: 404 },
    ).restore;
    const user = userEvent.setup();

    render(
      <LiveDataProvider profile={profile}>
        <HistoryPage />
      </LiveDataProvider>,
    );

    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument();
    expect(await screen.findByText('No history in this range yet.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Readings' }));
    const detail = await screen.findByRole('table', { name: /Reading at/ });
    expect(within(detail).getByRole('row', { name: 'PV power 278 W' })).toBeInTheDocument();
    expect(within(detail).queryByText('Output priority')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });
});
