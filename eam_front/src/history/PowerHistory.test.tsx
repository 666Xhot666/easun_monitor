import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import PowerHistory from './PowerHistory';

const history = {
  source: 'raw',
  bucketSeconds: 300,
  points: [
    { timestamp: '2026-10-07T10:00:00.000Z', values: { pvPower: 2000, loadPower: 900, gridPower: 0, batteryPower: 1040, batteryVoltage: 52, batterySoc: 60 } },
    { timestamp: '2026-10-07T10:05:00.000Z', values: { pvPower: 2840, loadPower: 1260, gridPower: 0, batteryPower: 1581, batteryVoltage: 52.7, batterySoc: 72, gridVoltage: 231 } },
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
    expect(server.sent[0].params.readings.split(',')).toEqual(expect.arrayContaining(['pvPower', 'batterySoc', 'gridVoltage']));
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
