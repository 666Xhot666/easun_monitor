import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import BmsSetup from './BmsSetup';
import type { BmsDevice } from './types';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const device = (overrides: Partial<BmsDevice> = {}): BmsDevice => ({
  id: 3,
  name: 'House battery',
  sourceType: 'mac-ble',
  bluetoothId: null,
  lastSeenAt: new Date(NOW - 4_000).toISOString(),
  createdAt: '2026-10-06T10:00:00.000Z',
  inverterProfileId: 7,
  useForEnergyFlow: false,
  ...overrides,
});

function renderSetup(handler: (method: string, url: string, body: unknown) => Reply) {
  const server = fakeServer((config) =>
    handler(config.method ?? 'get', config.url ?? '', config.data ? JSON.parse(config.data) : undefined),
  );
  render(<BmsSetup profileId={7} now={() => NOW} />);
  return server;
}

describe('BmsSetup', () => {
  let restore = () => {};
  beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true));
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('lists the BMS devices with when each last reported', async () => {
    restore = renderSetup(() => ({
      status: 200,
      data: [device(), device({ id: 4, name: 'Shed', sourceType: 'esp32', lastSeenAt: null })],
    })).restore;

    const first = await screen.findByRole('listitem', { name: 'House battery' });
    expect(first).toHaveTextContent('Mac Bluetooth reader');
    expect(first).toHaveTextContent('Last reading 4s ago');
    expect(screen.getByRole('listitem', { name: 'Shed' })).toHaveTextContent('No reading yet');
  });

  it('adds a BMS and shows its token once, with the reader settings', async () => {
    let devices: BmsDevice[] = [];
    const server = renderSetup((method) => {
      if (method === 'post') {
        devices = [device({ lastSeenAt: null })];
        return { status: 201, data: { device: devices[0], token: 'tok_abc123' } };
      }
      return { status: 200, data: devices };
    });
    restore = server.restore;

    await screen.findByText('No BMS yet.');
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'House battery');
    await userEvent.selectOptions(screen.getByLabelText('Reads it'), 'mac-ble');
    await userEvent.click(screen.getByRole('button', { name: 'Add BMS' }));

    const post = server.sent.find((c) => c.method === 'post');
    expect(post?.url).toBe('/api/inverter/profiles/7/bms');
    expect(JSON.parse(post?.data)).toEqual({ name: 'House battery', sourceType: 'mac-ble' });

    const shown = await screen.findByRole('region', { name: 'New ingest token' });
    expect(shown).toHaveTextContent('BMS_INGEST_TOKEN=tok_abc123');
    expect(shown).toHaveTextContent(`BMS_INGEST_URL=${window.location.origin}/api/bms/ingest`);
    expect(shown).toHaveTextContent('shown only once');
    expect(await screen.findByRole('listitem', { name: 'House battery' })).toBeInTheDocument();

    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(/tok_abc123/)).not.toBeInTheDocument();
  });

  it('replaces a lost token after confirming', async () => {
    const server = renderSetup((method) =>
      method === 'post' ? { status: 201, data: { token: 'tok_new' } } : { status: 200, data: [device()] },
    );
    restore = server.restore;

    await userEvent.click(await screen.findByRole('button', { name: 'New token for House battery' }));

    expect(window.confirm).toHaveBeenCalledWith(
      'Make a new ingest token for House battery? The reader stops working until it uses the new one.',
    );
    expect(server.sent.find((c) => c.method === 'post')?.url).toBe('/api/inverter/profiles/7/bms/3/token');
    expect(await screen.findByRole('region', { name: 'New ingest token' })).toHaveTextContent('tok_new');
  });

  it('removes a BMS after confirming', async () => {
    let devices = [device()];
    const server = renderSetup((method) => {
      if (method === 'delete') {
        devices = [];
        return { status: 200, data: { success: true } };
      }
      return { status: 200, data: devices };
    });
    restore = server.restore;

    await userEvent.click(await screen.findByRole('button', { name: 'Remove House battery' }));

    expect(window.confirm).toHaveBeenCalledWith('Remove House battery and all its stored readings?');
    expect(server.sent.find((c) => c.method === 'delete')?.url).toBe('/api/inverter/profiles/7/bms/3');
    expect(await screen.findByText('No BMS yet.')).toBeInTheDocument();
  });

  it("shows the server's reason when something fails", async () => {
    restore = renderSetup((method) =>
      method === 'post' ? { status: 400, data: { statusCode: 400, message: 'name should not be empty' } } : { status: 200, data: [] },
    ).restore;

    await screen.findByText('No BMS yet.');
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.click(screen.getByRole('button', { name: 'Add BMS' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('name should not be empty');
  });

  it('switches the energy flow over to the BMS values', async () => {
    let devices = [device()];
    const server = renderSetup((method, _url, body) => {
      if (method === 'patch') {
        devices = [device(body as Partial<BmsDevice>)];
        return { status: 200, data: devices[0] };
      }
      return { status: 200, data: devices };
    });
    restore = server.restore;

    const box = await screen.findByRole('checkbox', { name: 'Use House battery for the energy flow' });
    expect(box).not.toBeChecked();
    expect(screen.getByText(/once the current's sign is confirmed/)).toBeInTheDocument();

    await userEvent.click(box);

    const patch = server.sent.find((c) => c.method === 'patch');
    expect(patch?.url).toBe('/api/inverter/profiles/7/bms/3');
    expect(JSON.parse(patch?.data)).toEqual({ useForEnergyFlow: true });
    expect(await screen.findByRole('checkbox', { name: 'Use House battery for the energy flow' })).toBeChecked();
  });
});
