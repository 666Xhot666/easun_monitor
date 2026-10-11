import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import NoticesPanel from './NoticesPanel';

const NOW = Date.parse('2026-10-11T10:00:00Z');
const data = {
  limits: { heatC: 90, storageFreePercent: 10, memoryUsedPercent: 90 },
  events: [{ id: 2, kind: 'server-heat', text: 'Server: overheating, 93 °C (Package id 0)', at: new Date(NOW - 3 * 60_000).toISOString() }],
};

function renderPanel(owner: boolean, put: { status: number; data?: unknown } = { status: 200 }) {
  const server = fakeServer((config) =>
    config.method === 'put' ? { status: put.status, data: put.data ?? JSON.parse(config.data) } : { status: 200, data },
  );
  render(<NoticesPanel owner={owner} now={NOW} />);
  return server;
}

describe('NoticesPanel', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('lists the recent notices', async () => {
    restore = renderPanel(false).restore;
    expect(await screen.findByText('Server: overheating, 93 °C (Package id 0)')).toBeInTheDocument();
    expect(screen.getByText('3 min ago')).toBeInTheDocument();
    expect(screen.getByText('Overheating at 90 °C · storage low under 10 % free · memory short at 90 % used')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save limits' })).not.toBeInTheDocument();
  });

  it('lets the owner change the limits', async () => {
    const server = renderPanel(true);
    restore = server.restore;
    const heat = await screen.findByRole('spinbutton', { name: 'Overheating at (°C)' });
    await userEvent.clear(heat);
    await userEvent.type(heat, '85');
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    const put = server.sent.find((c) => c.method === 'put');
    expect(put?.url).toBe('/api/server/alerts/limits');
    expect(JSON.parse(put?.data)).toEqual({ heatC: 85, storageFreePercent: 10, memoryUsedPercent: 90 });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it("shows the server's reason when it refuses", async () => {
    restore = renderPanel(true, { status: 400, data: { message: 'heatC must be a whole number from 40 to 110' } }).restore;
    await userEvent.click(await screen.findByRole('button', { name: 'Save limits' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('heatC must be a whole number from 40 to 110');
  });
});
