import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InverterProfile } from '../auth/types';
import { fakeServer, type Reply } from '../test/fakeServer';
import SolarArrayForm from './SolarArrayForm';
import type { PanelType } from './pvArray';

const longi: PanelType = { id: 1, name: 'Longi 450W', maxPowerW: 450, vmpV: 41.5, impA: 10.85, vocV: 49.5, iscA: 11.5 };
const jinko: PanelType = { id: 2, name: 'Jinko 550W', maxPowerW: 550, vmpV: 42.3, impA: 13, vocV: 50.7, iscA: 13.9 };

const profile = (overrides: Partial<InverterProfile> = {}): InverterProfile => ({
  id: 7, name: 'Home', ipAddress: '192.168.1.50', port: 8899, ratedPowerWatts: 3200,
  batteryNominalVoltage: 24, batteryCapacityAh: 100, batteryType: 'LIFEPO4',
  lowBatteryCutoffVoltage: null, bulkChargeVoltage: null, floatChargeVoltage: null,
  pvPanelTypeId: null, pvPanelsInSeries: null, pvStrings: null,
  pvMaxVocV: null, pvMpptMinV: null, pvMpptMaxV: null, pvMaxPowerW: null, pvMaxCurrentA: null,
  createdAt: '', updatedAt: '',
  ...overrides,
});

function renderForm(p: InverterProfile, handler: () => Reply = () => ({ status: 200, data: {} })) {
  const onSaved = vi.fn();
  const server = fakeServer(handler);
  render(<SolarArrayForm profile={p} panelTypes={[longi, jinko]} onSaved={onSaved} />);
  return { ...server, onSaved };
}

async function set(label: string, value: string) {
  await userEvent.clear(screen.getByLabelText(label));
  if (value) await userEvent.type(screen.getByLabelText(label), value);
}

describe('SolarArrayForm', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('shows the saved array and its ratings', () => {
    restore = renderForm(profile({ pvPanelTypeId: 1, pvPanelsInSeries: 3, pvStrings: 2 })).restore;

    expect(screen.getByLabelText('Panel type')).toHaveValue('1');
    expect(screen.getByLabelText('Panels in series per string')).toHaveValue(3);
    expect(screen.getByLabelText('Strings in parallel')).toHaveValue(2);
    const summary = screen.getByRole('region', { name: 'Array ratings' });
    expect(summary).toHaveTextContent('6 panels (3S2P)');
    expect(summary).toHaveTextContent('2700 W');
    expect(summary).toHaveTextContent('Vmp 124.5 V');
    expect(summary).toHaveTextContent('Voc 148.5 V');
    expect(summary).toHaveTextContent('Imp 21.7 A');
    expect(summary).toHaveTextContent('Isc 23 A');
  });

  it('recalculates as the wiring changes and warns against the limits entered', async () => {
    restore = renderForm(profile({ pvPanelTypeId: 1, pvPanelsInSeries: 3, pvStrings: 2 })).restore;

    await set('Panels in series per string', '11');
    await set('Max open-circuit voltage (V)', '500');

    const summary = screen.getByRole('region', { name: 'Array ratings' });
    expect(summary).toHaveTextContent('22 panels (11S2P)');
    expect(summary).toHaveTextContent('Voc 544.5 V');
    expect(screen.getByText(/Open-circuit voltage 544.5 V is above the inverter maximum of 500 V/)).toBeInTheDocument();
  });

  it('asks for the array when none is set up', () => {
    restore = renderForm(profile()).restore;

    expect(screen.getByLabelText('Panel type')).toHaveValue('');
    expect(screen.getByText('Choose a panel type and the wiring to see the array ratings.')).toBeInTheDocument();
  });

  it('saves the array and limits to the profile, blanks as cleared', async () => {
    const { sent, onSaved, restore: r } = renderForm(profile({ pvMpptMaxV: 450 }));
    restore = r;

    await userEvent.selectOptions(screen.getByLabelText('Panel type'), '2');
    await set('Panels in series per string', '4');
    await set('Strings in parallel', '1');
    await set('Max open-circuit voltage (V)', '500');
    await set('MPPT maximum (V)', '');
    await userEvent.click(screen.getByRole('button', { name: 'Save array' }));

    expect(sent[0].method).toBe('patch');
    expect(sent[0].url).toBe('/api/inverter/profiles/7');
    expect(JSON.parse(sent[0].data)).toEqual({
      pvPanelTypeId: 2, pvPanelsInSeries: 4, pvStrings: 1,
      pvMaxVocV: 500, pvMpptMinV: null, pvMpptMaxV: null, pvMaxPowerW: null, pvMaxCurrentA: null,
    });
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it("shows the server's reason when saving fails", async () => {
    const { onSaved, restore: r } = renderForm(profile(), () => ({ status: 400, data: { statusCode: 400, message: 'Unknown panel type' } }));
    restore = r;

    await userEvent.click(screen.getByRole('button', { name: 'Save array' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown panel type');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
