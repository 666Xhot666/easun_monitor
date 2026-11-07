import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
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
  cellLowAlertV: null,
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
  afterEach(() => restore());

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
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'How it is read' })).getByRole('radio', { name: 'Mac Bluetooth reader' }));
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

    const dialog = screen.getByRole('dialog', { name: 'Make a new reader token for House battery?' });
    expect(dialog).toHaveTextContent('The reader stops working until it uses the new one.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make a new token' }));
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

    const dialog = screen.getByRole('dialog', { name: 'Remove House battery?' });
    expect(dialog).toHaveTextContent('Its stored readings are deleted too.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
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

  it("sets the low-cell alert voltage, by default a little above the BMS's own undervoltage recovery", async () => {
    let saved: number | null = null;
    const server = renderSetup((method, url, body) => {
      if (method === 'patch') {
        saved = (body as { cellLowAlertV: number | null }).cellLowAlertV;
        return { status: 200, data: device({ cellLowAlertV: saved }) };
      }
      if (url.endsWith('/settings'))
        return { status: 200, data: { protocol: 'JK02_32S', decoderVersion: 'jk-ble/2', receivedAt: '', settings: { cellUndervoltageRecoveryV: 2.9 } } };
      return { status: 200, data: [device({ cellLowAlertV: saved })] };
    });
    restore = server.restore;
    const user = userEvent.setup();

    const row = await screen.findByRole('listitem', { name: 'House battery' });
    expect(await within(row).findByText(/Default 3\.00 V: 0\.1 V above the BMS's undervoltage recovery \(2\.90 V\)/)).toBeInTheDocument();
    const field = within(row).getByLabelText('Low cell alert (V)');
    expect(field).toHaveValue(null);

    await user.type(field, '3.1');
    await user.click(within(row).getByRole('button', { name: 'Save low cell alert' }));
    expect(JSON.parse(server.sent.filter((c) => c.method === 'patch').at(-1)?.data)).toEqual({ cellLowAlertV: 3.1 });

    await user.clear(within(row).getByLabelText('Low cell alert (V)'));
    await user.click(within(row).getByRole('button', { name: 'Save low cell alert' }));
    expect(JSON.parse(server.sent.filter((c) => c.method === 'patch').at(-1)?.data)).toEqual({ cellLowAlertV: null });
  });

  it('says there is no low-cell alert until the BMS has sent its limits', async () => {
    restore = renderSetup((_method, url) =>
      url.endsWith('/settings') ? { status: 404 } : { status: 200, data: [device()] },
    ).restore;

    const row = await screen.findByRole('listitem', { name: 'House battery' });
    expect(await within(row).findByText(/No low-cell alert until the BMS has sent its settings/)).toBeInTheDocument();
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

    const box = await screen.findByRole('switch', { name: 'Use House battery for the energy flow' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/once the current's sign is confirmed/)).toBeInTheDocument();

    await userEvent.click(box);

    const patch = server.sent.find((c) => c.method === 'patch');
    expect(patch?.url).toBe('/api/inverter/profiles/7/bms/3');
    expect(JSON.parse(patch?.data)).toEqual({ useForEnergyFlow: true });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Use House battery for the energy flow' })).toHaveAttribute('aria-checked', 'true'));
  });
});
