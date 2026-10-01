import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import InverterSettings from './InverterSettings';

const registers = [
  { name: 'OutputPriority', label: 'Output priority', address: 301, type: 'uint16', group: 'settings', writable: true, options: ['Utility first (UTI)', 'Solar first (SOL)', 'Solar-battery-utility (SBU)'] },
  { name: 'OutputVoltageSet', label: 'Output voltage', address: 320, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'OutputFrequencySet', label: 'Output frequency', address: 321, type: 'uint16', scale: 0.01, unit: 'Hz', group: 'settings', writable: true, choices: [50, 60] },
  { name: 'RatedPower', label: 'Rated power', address: 643, type: 'uint16', unit: 'W', group: 'settings' },
];
const snapshot = (values: Record<string, number>) => ({ values, readAt: '2026-09-30T12:00:00.000Z' });

function renderPage(handler: (method: string, url: string, body: unknown) => Reply) {
  const server = fakeServer((config) =>
    config.url === '/api/inverter/registers'
      ? { status: 200, data: registers }
      : handler(config.method ?? 'get', config.url ?? '', config.data ? JSON.parse(config.data) : undefined),
  );
  render(
    <MemoryRouter initialEntries={['/dashboard/7/settings']}>
      <Routes>
        <Route path="/dashboard/:profileId/settings" element={<InverterSettings />} />
      </Routes>
    </MemoryRouter>,
  );
  return server;
}

describe('InverterSettings page', () => {
  let restore = () => {};
  beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true));
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('shows the settings read from the inverter, with read-only ones as text', async () => {
    restore = renderPage(() => ({ status: 200, data: snapshot({ OutputPriority: 2, OutputVoltageSet: 230, RatedPower: 3200 }) })).restore;

    expect(await screen.findByLabelText('Output priority')).toHaveValue('2');
    expect(screen.getByLabelText('Output voltage')).toHaveValue(230);
    expect(screen.getByText('3,200 W')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  it('writes only the changed settings and shows what the inverter confirmed', async () => {
    const server = renderPage((method) =>
      method === 'patch'
        ? { status: 200, data: snapshot({ OutputPriority: 0, OutputVoltageSet: 230, RatedPower: 3200 }) }
        : { status: 200, data: snapshot({ OutputPriority: 2, OutputVoltageSet: 230, RatedPower: 3200 }) },
    );
    restore = server.restore;

    await userEvent.selectOptions(await screen.findByLabelText('Output priority'), '0');
    await userEvent.click(screen.getByRole('button', { name: /Save 1 change/ }));

    const patch = server.sent.find((c) => c.method === 'patch');
    expect(patch?.url).toBe('/api/inverter/7/settings');
    expect(JSON.parse(patch?.data)).toEqual({ changes: { OutputPriority: 0 } });
    expect(await screen.findByText('Saved. The inverter confirmed the new values.')).toBeInTheDocument();
    expect(screen.getByLabelText('Output priority')).toHaveValue('0');
  });

  it('blocks saving a value the inverter would refuse', async () => {
    restore = renderPage(() => ({ status: 200, data: snapshot({ OutputPriority: 2, OutputVoltageSet: 230 }) })).restore;

    const voltage = await screen.findByLabelText('Output voltage');
    await userEvent.clear(voltage);
    await userEvent.type(voltage, '230.25');

    expect(screen.getByText('Use steps of 0.1 V')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  it('shows the inverter refusing a change', async () => {
    restore = renderPage((method) =>
      method === 'patch'
        ? { status: 409, data: { message: 'Logger rejected the request: Registers are not allowed to be modified in the current working mode' } }
        : { status: 200, data: snapshot({ OutputPriority: 2, OutputVoltageSet: 230 }) },
    ).restore;

    await userEvent.selectOptions(await screen.findByLabelText('Output priority'), '1');
    await userEvent.click(screen.getByRole('button', { name: /Save 1 change/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not allowed to be modified/);
  });

  it('offers fixed-choice settings as a list of their values', async () => {
    restore = renderPage(() => ({ status: 200, data: snapshot({ OutputPriority: 2, OutputFrequencySet: 50 }) })).restore;

    const frequency = await screen.findByLabelText('Output frequency');
    expect(frequency).toHaveValue('50.00');
    expect(within(frequency).getAllByRole('option').map((o) => o.textContent)).toEqual(['50 Hz', '60 Hz']);
  });

  it('still shows a fixed-choice value the inverter holds outside its choices', async () => {
    restore = renderPage(() => ({ status: 200, data: snapshot({ OutputPriority: 2, OutputFrequencySet: 55 }) })).restore;

    expect(await screen.findByLabelText('Output frequency')).toHaveValue('55.00');
  });

  it('re-reads the settings from the inverter on request', async () => {
    let voltage = 230;
    const server = renderPage((method) => {
      if (method === 'post') voltage = 225;
      return { status: 200, data: snapshot({ OutputPriority: 2, OutputVoltageSet: voltage }) };
    });
    restore = server.restore;
    await screen.findByLabelText('Output voltage');

    await userEvent.click(screen.getByRole('button', { name: 'Refresh from inverter' }));

    await waitFor(() => expect(screen.getByLabelText('Output voltage')).toHaveValue(225));
    expect(server.sent.find((c) => c.method === 'post')?.url).toBe('/api/inverter/7/settings/refresh');
    expect(within(screen.getByRole('status')).getByText(/Read from the inverter/)).toBeInTheDocument();
  });
});
