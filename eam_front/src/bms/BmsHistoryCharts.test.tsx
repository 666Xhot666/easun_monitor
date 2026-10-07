import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import BmsHistoryCharts from './BmsHistoryCharts';

const history = (points: unknown[]) => ({ status: 200, data: { source: 'raw', bucketSeconds: 300, points } });

describe('BmsHistoryCharts', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('charts state of charge, pack voltage, current and cell spread over the last 24 hours', async () => {
    const server = fakeServer(() =>
      history([{ timestamp: '2026-10-06T10:00:00.000Z', values: { stateOfChargePct: 88, packVoltageV: 26.5, currentA: -3, cellDeltaV: 0.008 } }]),
    );
    restore = server.restore;

    render(<BmsHistoryCharts profileId={7} bmsId={3} />);

    for (const [title, latest] of [['State of charge', '88%'], ['Pack voltage', '26.50 V'], ['Current', '-3.0 A'], ['Cell spread', '8 mV']]) {
      expect(await screen.findByRole('figure', { name: title })).toHaveTextContent(latest);
    }
    expect(server.sent[0].url).toBe('/api/inverter/profiles/7/bms/3/history');
    expect(server.sent[0].params).toMatchObject({ points: 288, fields: 'stateOfChargePct,packVoltageV,currentA,cellDeltaV' });
  });

  it('reloads for another range, and says when nothing is stored', async () => {
    const server = fakeServer(() => history([]));
    restore = server.restore;

    render(<BmsHistoryCharts profileId={7} bmsId={3} />);
    expect(await screen.findByText('No stored BMS readings in this range.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: '7 d' }));
    await waitFor(() => expect(server.sent).toHaveLength(2));
    expect(screen.getByRole('radio', { name: '7 d' })).toHaveAttribute('aria-checked', 'true');
  });

  it("says when the history can't be loaded", async () => {
    restore = fakeServer(() => ({ status: 500 })).restore;

    render(<BmsHistoryCharts profileId={7} bmsId={3} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the battery history.');
  });
});
