import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { InverterProfile } from '../auth/types';
import { LiveDataProvider } from '../shell/LiveData';
import { fakeServer } from '../test/fakeServer';
import AlertsPage from './AlertsPage';

const profile = { id: 7, name: 'House', role: 'ADMIN' } as InverterProfile;
const at = (h: number) => new Date(new Date().setHours(h, 0, 0, 0)).toISOString();
const page1 = [
  { id: 5, kind: 'grid', text: 'Grid restored', source: null, at: at(14) },
  { id: 4, kind: 'grid', text: 'Grid lost', source: null, at: at(13) },
  { id: 3, kind: 'warning', text: 'BMS alarm: Cell overvoltage', source: 'House battery', at: at(9) },
];

function renderPage(alerts: (params: Record<string, string>) => unknown[], active: { faults: string[]; warnings: string[] } = { faults: [], warnings: [] }) {
  const server = fakeServer((config) => {
    if (config.url === '/api/inverter/7/alerts') return { status: 200, data: alerts(config.params ?? {}) };
    if (config.url === '/api/inverter/7/latest') return { status: 200, data: { id: 1, timestamp: new Date().toISOString(), payload: {}, alerts: active } };
    return { status: 404 };
  });
  render(
    <MemoryRouter>
      <LiveDataProvider profile={profile}>
        <AlertsPage />
      </LiveDataProvider>
    </MemoryRouter>,
  );
  return server;
}

describe('AlertsPage', () => {
  let restore = () => {};
  afterEach(() => {
    restore();
    localStorage.clear();
  });

  it('shows the recorded alerts by day, newest first, with their kind', async () => {
    restore = renderPage(() => page1).restore;

    expect(await screen.findByText('Grid restored')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('House battery')).toBeInTheDocument();
    expect(screen.getAllByText(/Grid (restored|lost)|BMS alarm/).map((e) => e.textContent)).toEqual([
      'Grid restored',
      'Grid lost',
      'BMS alarm: Cell overvoltage',
    ]);
  });

  it('narrows the list by kind', async () => {
    restore = renderPage(() => page1).restore;
    const user = userEvent.setup();
    await screen.findByText('Grid restored');

    await user.click(screen.getByRole('radio', { name: 'Warnings · 1' }));

    expect(screen.queryByText('Grid restored')).not.toBeInTheDocument();
    expect(screen.getByText('BMS alarm: Cell overvoltage')).toBeInTheDocument();
  });

  it('pages back through older alerts', async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ id: 100 - i, kind: 'grid', text: `Alert ${100 - i}`, source: null, at: at(12) }));
    const server = renderPage((params) => (params.before ? [{ id: 1, kind: 'fault', text: 'Faults cleared', source: null, at: at(1) }] : full));
    restore = server.restore;

    await userEvent.click(await screen.findByRole('button', { name: 'Load older alerts' }));

    expect(await screen.findByText('Faults cleared')).toBeInTheDocument();
    expect(server.sent.find((c) => c.params?.before)?.params).toMatchObject({ before: 51 });
  });

  it('puts what is active now above the history', async () => {
    restore = renderPage(() => [], { faults: ['Battery under-voltage'], warnings: [] }).restore;

    const active = await screen.findByRole('region', { name: 'Active now' });
    expect(within(active).getByText('Battery under-voltage')).toBeInTheDocument();
    expect(screen.getByText('No alerts recorded yet.')).toBeInTheDocument();
  });

  it('marks the alerts as seen for the bell', async () => {
    restore = renderPage(() => page1).restore;

    await screen.findByText('Grid restored');

    expect(localStorage.getItem('eam.alerts.seen.7')).toBe('5');
  });
});
