import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import ServerHistory from './ServerHistory';

const history = {
  bucketSeconds: 300,
  points: [
    { at: '2026-10-11T09:00:00.000Z', cpuPercent: 20, memoryPercent: 62.5, temperatureMax: 80, fanRpm: 2450, rxBytesPerSecond: 225, txBytesPerSecond: 20 },
    { at: '2026-10-11T09:05:00.000Z', cpuPercent: 64.2, memoryPercent: 70, temperatureMax: 61, fanRpm: 4900, rxBytesPerSecond: 1200, txBytesPerSecond: 300 },
    { at: '2026-10-11T09:10:00.000Z', cpuPercent: null, memoryPercent: null, temperatureMax: null, fanRpm: null, rxBytesPerSecond: null, txBytesPerSecond: null },
  ],
};

describe('ServerHistory', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('shows the peaks of the last 24 hours', async () => {
    const server = fakeServer(() => ({ status: 200, data: history }));
    restore = server.restore;
    render(<ServerHistory />);

    expect(await screen.findByText('Peak 64.2 %')).toBeInTheDocument();
    expect(screen.getByText('Peak 80 °C')).toBeInTheDocument();
    expect(screen.getByText('Peak ↓ 1.2 kB/s ↑ 300 B/s')).toBeInTheDocument();
    expect(server.sent[0].url).toBe('/api/server/history');
    expect(server.sent[0].params).toEqual({ range: '24h' });
  });

  it('reloads for the last 7 days', async () => {
    const server = fakeServer(() => ({ status: 200, data: history }));
    restore = server.restore;
    render(<ServerHistory />);
    await screen.findByText('Peak 64.2 %');

    await userEvent.click(screen.getByRole('radio', { name: '7 d' }));
    await waitFor(() => expect(server.sent).toHaveLength(2));
    expect(server.sent[1].params).toEqual({ range: '7d' });
  });

  it('says when there is nothing to show yet', async () => {
    restore = fakeServer(() => ({ status: 200, data: { bucketSeconds: 300, points: [] } })).restore;
    render(<ServerHistory />);
    expect(await screen.findByText('No history yet.')).toBeInTheDocument();
  });
});
