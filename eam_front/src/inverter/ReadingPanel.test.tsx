import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ReadingPanel from './ReadingPanel';
import type { RegisterDefinition } from './types';

const registers: RegisterDefinition[] = [
  { name: 'FaultCode', label: 'Faults', address: 100, type: 'uint32', group: 'status' },
  { name: 'OperationMode', label: 'Operating mode', address: 201, type: 'uint16', group: 'telemetry', options: ['Power on', 'Standby', 'Mains', 'Off-grid', 'Bypass', 'Charging', 'Fault'] },
  { name: 'MainsVoltage', label: 'Mains voltage', address: 202, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'BatteryVoltage', label: 'Battery voltage', address: 215, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'PVPower', label: 'PV power', address: 223, type: 'int16', unit: 'W', group: 'telemetry' },
  { name: 'BatterySoc', label: 'Battery state of charge', address: 229, type: 'uint16', unit: '%', group: 'telemetry' },
  { name: 'OutputVoltageSet', label: 'Output voltage', address: 320, type: 'uint16', scale: 0.1, unit: 'V', group: 'settings', writable: true },
];

const reading = {
  id: 1,
  timestamp: '2026-09-30T12:00:00Z',
  payload: { OperationMode: 2, MainsVoltage: 230.5, PVPower: 1200, BatterySoc: 87, FaultCode: 0 },
  alerts: { faults: [], warnings: ['Fan blocked'] },
};

describe('ReadingPanel', () => {
  it('shows the headline registers with labels and units from the register map', () => {
    render(<ReadingPanel registers={registers} reading={reading} />);
    const tiles = screen.getByRole('region', { name: 'Key metrics' });
    expect(within(tiles).getByText('Mains voltage')).toBeInTheDocument();
    expect(within(tiles).getByText('230.5 V')).toBeInTheDocument();
    expect(within(tiles).getByText('87 %')).toBeInTheDocument();
    // BatteryVoltage is missing from this reading.
    expect(within(tiles).getByText('no data')).toBeInTheDocument();
  });

  it('lists the other telemetry registers, not settings or status', () => {
    render(<ReadingPanel registers={registers} reading={reading} />);
    const all = screen.getByRole('region', { name: 'All parameters' });
    expect(within(all).getByText('Operating mode')).toBeInTheDocument();
    expect(within(all).getByText('Mains')).toBeInTheDocument();
    expect(within(all).queryByText('Output voltage')).not.toBeInTheDocument();
    expect(within(all).queryByText('Faults')).not.toBeInTheDocument();
  });

  it('shows active faults and warnings, or that there are none', () => {
    const { rerender } = render(<ReadingPanel registers={registers} reading={reading} />);
    expect(screen.getByText('Fan blocked')).toBeInTheDocument();

    rerender(
      <ReadingPanel
        registers={registers}
        reading={{ ...reading, alerts: { faults: ['Output overload'], warnings: [] } }}
      />,
    );
    expect(screen.getByText('Output overload')).toBeInTheDocument();

    rerender(<ReadingPanel registers={registers} reading={{ ...reading, alerts: { faults: [], warnings: [] } }} />);
    expect(screen.getByText('No active faults or warnings')).toBeInTheDocument();
  });

  it('offers to exit fault mode only while the inverter is in it', async () => {
    const exit = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { rerender } = render(<ReadingPanel registers={registers} reading={reading} onExitFaultMode={exit} />);
    expect(screen.queryByRole('button', { name: 'Exit fault mode' })).not.toBeInTheDocument();

    rerender(
      <ReadingPanel registers={registers} reading={{ ...reading, payload: { ...reading.payload, OperationMode: 6 } }} onExitFaultMode={exit} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Exit fault mode' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/clear the fault/i));
    expect(exit).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('shows why exiting fault mode failed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const exit = vi.fn().mockRejectedValue(new Error('The inverter is not in fault mode'));
    render(
      <ReadingPanel registers={registers} reading={{ ...reading, payload: { ...reading.payload, OperationMode: 6 } }} onExitFaultMode={exit} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Exit fault mode' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The inverter is not in fault mode');
    vi.restoreAllMocks();
  });
});
