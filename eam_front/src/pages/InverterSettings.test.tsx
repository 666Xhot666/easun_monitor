import { AuthContext, type AuthContextValue } from '../auth/context';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import InverterSettings from './InverterSettings';

const registers = [
  {
    name: 'OutputPriority', label: 'Output priority', address: 301, type: 'uint16', group: 'settings', writable: true,
    options: ['Utility first (UTI)', 'Solar first (SOL)', 'Solar-battery-utility (SBU)'],
    panelProgram: '01', default: 0,
    description: 'Which source powers the loads first.',
    optionDescriptions: ['Utility powers the loads.', 'Solar powers the loads.', 'Solar, then battery, then utility.'],
  },
  { name: 'OutputVoltageSet', label: 'Output voltage', address: 320, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'OutputFrequencySet', label: 'Output frequency', address: 321, type: 'uint16', scale: 0.01, unit: 'Hz', group: 'settings', writable: true, choices: [50, 60] },
  { name: 'MaxChargingVoltage', label: 'Max charging voltage (bulk)', address: 324, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true, defaultByBatteryVoltage: { 24: 28.2, 48: 56.4 } },
  { name: 'FloatingChargingVoltage', label: 'Float charging voltage', address: 325, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  { name: 'BatteryEqModeEnabled', label: 'Battery equalization', address: 313, type: 'uint16', group: 'settings', writable: true, options: ['Disabled', 'Enabled'] },
  { name: 'EqChargingVoltage', label: 'Equalization voltage', address: 334, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
  {
    name: 'RemoteSwitch', label: 'Remote switch', address: 420, type: 'uint16', group: 'settings', writable: true,
    options: ['Off', 'On'], risk: 'Remote shutdown turns off the AC output.',
  },
  { name: 'RatedPower', label: 'Rated power', address: 643, type: 'uint16', unit: 'W', group: 'settings' },
];
const snapshot = (values: Record<string, number>) => ({ values, readAt: '2026-09-30T12:00:00.000Z' });
const noConstraints = { batteryVoltage: null, bounds: {}, defaults: {}, rules: [] };

function renderPage(
  handler: (method: string, url: string, body: unknown) => Reply,
  constraints: unknown = noConstraints,
  panelSettings: unknown[] = [],
  role: 'ADMIN' | 'READER' = 'ADMIN',
) {
  const server = fakeServer((config) =>
    config.url === '/api/inverter/registers'
      ? { status: 200, data: registers }
      : config.url === '/api/inverter/panel-settings'
        ? { status: 200, data: panelSettings }
        : config.url === '/api/inverter/profiles/7/bms'
        ? { status: 200, data: [] }
        : config.url === '/api/inverter/7/settings/constraints'
        ? { status: 200, data: constraints }
        : handler(config.method ?? 'get', config.url ?? '', config.data ? JSON.parse(config.data) : undefined),
  );
  const auth = { user: { inverterProfiles: [{ id: 7, role }] } } as unknown as AuthContextValue;
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/dashboard/7/settings']}>
        <Routes>
          <Route path="/dashboard/:profileId/settings" element={<InverterSettings />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
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

  it('explains a setting: panel program, default and what each option does', async () => {
    restore = renderPage(() => ({ status: 200, data: snapshot({ OutputPriority: 2 }) })).restore;
    await screen.findByLabelText('Output priority');

    expect(screen.getByText('Program 01')).toBeInTheDocument();
    expect(screen.getByText('Default: Utility first (UTI)')).toBeInTheDocument();
    expect(screen.queryByText('Which source powers the loads first.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'About Output priority' }));

    expect(screen.getByText('Which source powers the loads first.')).toBeInTheDocument();
    expect(screen.getByText('Solar, then battery, then utility.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Output priority' })).toHaveAttribute('aria-expanded', 'true');
  });

  describe('with the rules for a 24 V battery', () => {
    const constraints = {
      batteryVoltage: 24,
      bounds: { MaxChargingVoltage: { min: 24, max: 30, context: 'for a 24 V battery' } },
      defaults: { MaxChargingVoltage: 28.2 },
      rules: [
        {
          id: 'R-VOLT-1', kind: 'compare', severity: 'error',
          left: 'MaxChargingVoltage', op: '>=', right: 'FloatingChargingVoltage',
          message: 'Bulk charging voltage must be at least the float charging voltage',
        },
      ],
    };
    const values = { OutputPriority: 2, MaxChargingVoltage: 28.2, FloatingChargingVoltage: 27 };

    it("shows the battery's range and default", async () => {
      restore = renderPage(() => ({ status: 200, data: snapshot(values) }), constraints).restore;

      expect(await screen.findByText('24.0–30.0 V')).toBeInTheDocument();
      expect(screen.getByText('Default: 28.2 V')).toBeInTheDocument();
    });

    it('blocks a value outside that range', async () => {
      restore = renderPage(() => ({ status: 200, data: snapshot(values) }), constraints).restore;

      const bulk = await screen.findByLabelText('Max charging voltage (bulk)');
      await userEvent.clear(bulk);
      await userEvent.type(bulk, '56.4');

      expect(await screen.findByText('Must be between 24 and 30 for a 24 V battery')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
    });

    it('flags an edit that contradicts an unchanged setting on both', async () => {
      restore = renderPage(() => ({ status: 200, data: snapshot(values) }), constraints).restore;

      const bulk = await screen.findByLabelText('Max charging voltage (bulk)');
      await userEvent.clear(bulk);
      await userEvent.type(bulk, '26.5');

      expect(await screen.findAllByText('Bulk charging voltage must be at least the float charging voltage')).toHaveLength(2);
      expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
    });
  });

  describe('with the rules for a lithium battery', () => {
    const constraints = {
      ...noConstraints,
      rules: [
        { id: 'R-TYPE-2', kind: 'avoid', setting: 'BatteryEqModeEnabled', value: 1, message: 'Never equalize a lithium battery' },
        {
          id: 'R-EQ-1', kind: 'inactive', settings: ['EqChargingVoltage'],
          when: 'BatteryEqModeEnabled', in: [1], reason: 'Only used while battery equalization is enabled',
        },
      ],
    };
    const values = { OutputPriority: 2, BatteryEqModeEnabled: 0, EqChargingVoltage: 29.2 };

    it('asks the user to acknowledge a warning before writing', async () => {
      const server = renderPage(
        (method) => ({ status: 200, data: snapshot(method === 'patch' ? { ...values, BatteryEqModeEnabled: 1 } : values) }),
        constraints,
      );
      restore = server.restore;

      await userEvent.selectOptions(await screen.findByLabelText('Battery equalization'), '1');
      expect(screen.getByText('Never equalize a lithium battery')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Save 1 change/ }));

      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Never equalize a lithium battery'));
      const patch = server.sent.find((c) => c.method === 'patch');
      expect(JSON.parse(patch?.data)).toEqual({ changes: { BatteryEqModeEnabled: 1 }, acknowledgeWarnings: true });
    });

    it('marks settings that currently have no effect', async () => {
      restore = renderPage(() => ({ status: 200, data: snapshot(values) }), constraints).restore;

      await screen.findByLabelText('Equalization voltage');
      expect(screen.getByText('Only used while battery equalization is enabled')).toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText('Battery equalization'), '1');
      expect(screen.queryByText('Only used while battery equalization is enabled')).not.toBeInTheDocument();
    });
  });

  it('shows risky settings with the others and confirms each one with its consequence', async () => {
    const server = renderPage(() => ({ status: 200, data: snapshot({ OutputPriority: 2, RemoteSwitch: 1 }) }));
    restore = server.restore;
    await screen.findByLabelText('Output priority');
    expect(screen.queryByRole('button', { name: 'Show advanced settings' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Remote switch'), '0');
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: /Save 1 change/ }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenCalledWith(
      'Remote switch: Remote shutdown turns off the AC output.\n\nChange it anyway?',
    );
    expect(server.sent.some((c) => c.method === 'patch')).toBe(false);
  });

  it("lists the panel-only settings and links the settings they affect", async () => {
    const batteryType = {
      program: '05', title: 'Battery type', default: 'AGM',
      description: 'Decides whether the charge voltages below apply.',
      options: ['AGM', 'Flooded', 'User-Defined', 'Lithium without communication'],
      affects: ['MaxChargingVoltage'],
    };
    restore = renderPage(
      () => ({ status: 200, data: snapshot({ OutputPriority: 2, MaxChargingVoltage: 28.2 }) }),
      noConstraints,
      [batteryType],
    ).restore;

    const panel = await screen.findByRole('region', { name: "Set on the inverter's panel" });
    expect(within(panel).getByText('Battery type')).toBeInTheDocument();
    expect(within(panel).getByText('Program 05 · Default: AGM')).toBeInTheDocument();
    expect(within(panel).getByText('AGM, Flooded, User-Defined, Lithium without communication')).toBeInTheDocument();
    expect(within(panel).queryByRole('combobox')).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Depends on panel program 05' })).toHaveAttribute('href', '#panel-05');
  });

  it('fills in lithium settings from the BMS limits as unsaved edits', async () => {
    const server = renderPage(() => ({
      status: 200,
      data: snapshot({ OutputPriority: 2, MaxChargingVoltage: 28.2, FloatingChargingVoltage: 27 }),
    }));
    restore = server.restore;
    await screen.findByLabelText('Max charging voltage (bulk)');

    await userEvent.click(screen.getByRole('button', { name: 'Set up a lithium battery without BMS communication' }));
    await userEvent.type(screen.getByLabelText('BMS max charging voltage (V)'), '29.2');
    await userEvent.type(screen.getByLabelText('BMS max charging current (A)'), '100');
    await userEvent.type(screen.getByLabelText('BMS discharge protection voltage (V)'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Fill in proposed values' }));

    expect(screen.getByLabelText('Max charging voltage (bulk)')).toHaveValue(28.7);
    expect(screen.getByLabelText('Float charging voltage')).toHaveValue(28.7);
    expect(screen.getByRole('button', { name: 'Save 2 changes' })).toBeEnabled();
    expect(server.sent.some((c) => c.method === 'patch')).toBe(false);
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

  it('offers the battery monitor setup, whatever the inverter does', async () => {
    restore = renderPage(() => ({ status: 503, data: { statusCode: 503, message: 'Inverter unreachable' } })).restore;

    expect(await screen.findByRole('heading', { name: 'Battery monitor (BMS)' })).toBeInTheDocument();
    expect(await screen.findByText('No BMS yet.')).toBeInTheDocument();
  });

  it('shows a reader the settings without letting them change anything', async () => {
    restore = renderPage(() => ({ status: 200, data: snapshot({ OutputPriority: 2, OutputVoltageSet: 230 }) }), noConstraints, [], 'READER').restore;

    expect(await screen.findByLabelText('Output priority')).toBeDisabled();
    expect(screen.getByLabelText('Output voltage')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
    expect(screen.getByText('Read-only: only a household admin can change settings.')).toBeInTheDocument();
    expect(await screen.findByText('No BMS yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add BMS' })).not.toBeInTheDocument();
  });
});
