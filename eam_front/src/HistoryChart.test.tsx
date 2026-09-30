import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import HistoryChart from './HistoryChart';
import { fakeServer } from './test/fakeServer';

const empty = { source: 'raw', bucketSeconds: 60, points: [] };

describe('HistoryChart', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('loads the last 24 hours by default and reloads when another range is picked', async () => {
    const server = fakeServer(() => ({ status: 200, data: empty }));
    restore = server.restore;

    render(<HistoryChart profileId={7} />);
    await screen.findByText(/No history/);
    const first = server.sent[0];
    expect(first.url).toBe('/api/inverter/7/history');
    expect(first.params.points).toBe(288);

    await userEvent.click(screen.getByRole('button', { name: '1 y' }));
    await waitFor(() => expect(server.sent).toHaveLength(2));
    expect(server.sent[1].params.points).toBe(365);
    expect(screen.getByRole('button', { name: '1 y' })).toHaveAttribute('aria-pressed', 'true');
  });
});
