import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import PowerHistory from './PowerHistory';

const history = {
  source: 'raw',
  bucketSeconds: 300,
  points: [
    { timestamp: '2026-10-07T10:00:00.000Z', values: { PVPower: 2000, OutputActivePower: 900, AverageMainsPower: 0, BatteryCurrentSigned: 20, BatteryVoltage: 52, BatterySoc: 60 } },
    { timestamp: '2026-10-07T10:05:00.000Z', values: { PVPower: 2840, OutputActivePower: 1260, AverageMainsPower: 0, BatteryCurrentSigned: 30, BatteryVoltage: 52.7, BatterySoc: 72, MainsVoltage: 231 } },
  ],
};

describe('PowerHistory', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('shows the latest value of each series shown, power in kW and the battery signed', async () => {
    const server = fakeServer(() => ({ status: 200, data: history }));
    restore = server.restore;

    render(<PowerHistory profileId={7} />);

    expect(await screen.findByText('2.84 kW')).toBeInTheDocument();
    expect(screen.getByText('1.26 kW')).toBeInTheDocument();
    expect(screen.getByText('+1.58 kW')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText(/Battery: \+ charging, − discharging/)).toBeInTheDocument();
    expect(server.sent[0].url).toBe('/api/inverter/7/history');
    expect(server.sent[0].params).toMatchObject({ points: 288 });
    expect(server.sent[0].params.fields.split(',')).toEqual(expect.arrayContaining(['PVPower', 'BatterySoc', 'MainsVoltage']));
  });

  it('adds and removes series', async () => {
    restore = fakeServer(() => ({ status: 200, data: history })).restore;
    const user = userEvent.setup();

    render(<PowerHistory profileId={7} />);
    await screen.findByText('2.84 kW');

    expect(screen.getByRole('button', { name: 'Mains voltage' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Mains voltage' }));
    expect(screen.getByText('231.0 V')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Solar' }));
    expect(screen.queryByText('2.84 kW')).not.toBeInTheDocument();
  });

  it('reloads for another range', async () => {
    const server = fakeServer(() => ({ status: 200, data: history }));
    restore = server.restore;

    render(<PowerHistory profileId={7} />);
    await screen.findByText('2.84 kW');
    await userEvent.click(screen.getByRole('radio', { name: '7 d' }));

    await waitFor(() => expect(server.sent).toHaveLength(2));
    expect(server.sent[1].params).toMatchObject({ points: 336 });
  });
});
