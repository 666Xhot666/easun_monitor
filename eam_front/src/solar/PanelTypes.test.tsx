import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import PanelTypes from './PanelTypes';
import type { PanelType } from './pvArray';

const longi: PanelType = { id: 1, name: 'Longi 450W', maxPowerW: 450, vmpV: 41.5, impA: 10.85, vocV: 49.5, iscA: 11.5 };

function renderList(handler: (method: string, url: string, body: unknown) => Reply, panelTypes = [longi]) {
  const onSaved = vi.fn();
  const server = fakeServer((config) =>
    handler(config.method ?? 'get', config.url ?? '', config.data ? JSON.parse(config.data) : undefined),
  );
  render(<PanelTypes panelTypes={panelTypes} onSaved={onSaved} />);
  return { ...server, onSaved };
}

async function fill(values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    await userEvent.clear(screen.getByLabelText(label));
    await userEvent.type(screen.getByLabelText(label), value);
  }
}

describe('PanelTypes', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('lists each panel type with its datasheet values', () => {
    restore = renderList(() => ({ status: 200 })).restore;

    const row = screen.getByRole('row', { name: /Longi 450W/ });
    for (const text of ['450 W', '41.5 V', '10.85 A', '49.5 V', '11.5 A']) {
      expect(within(row).getByText(text)).toBeInTheDocument();
    }
  });

  it('adds a panel type from the datasheet values', async () => {
    const { sent, onSaved, restore: r } = renderList(() => ({ status: 201, data: {} }));
    restore = r;

    await userEvent.click(screen.getByRole('button', { name: 'Add panel type' }));
    await fill({ Name: 'Jinko 550W', 'Pmax (W)': '550', 'Vmp (V)': '42.3', 'Imp (A)': '13', 'Voc (V)': '50.7', 'Isc (A)': '13.9' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/api/panel-types');
    expect(JSON.parse(sent[0].data)).toEqual({ name: 'Jinko 550W', maxPowerW: 550, vmpV: 42.3, impA: 13, vocV: 50.7, iscA: 13.9 });
    expect(onSaved).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('edits a panel type in place', async () => {
    const { sent, onSaved, restore: r } = renderList(() => ({ status: 200, data: {} }));
    restore = r;

    await userEvent.click(screen.getByRole('button', { name: 'Edit Longi 450W' }));
    expect(screen.getByLabelText('Vmp (V)')).toHaveValue(41.5);
    await fill({ 'Pmax (W)': '455' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent[0].method).toBe('patch');
    expect(sent[0].url).toBe('/api/panel-types/1');
    expect(JSON.parse(sent[0].data)).toMatchObject({ name: 'Longi 450W', maxPowerW: 455 });
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows the server's reason when a save or delete is refused", async () => {
    const { onSaved, restore: r } = renderList((method) =>
      method === 'delete'
        ? { status: 409, data: { statusCode: 409, message: 'An inverter uses this panel type; choose another type for it first' } }
        : { status: 400, data: { statusCode: 400, message: 'Vmp must not exceed Voc' } },
    );
    restore = r;

    await userEvent.click(screen.getByRole('button', { name: 'Delete Longi 450W' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('An inverter uses this panel type');

    await userEvent.click(screen.getByRole('button', { name: 'Add panel type' }));
    await fill({ Name: 'Odd', 'Pmax (W)': '100', 'Vmp (V)': '60', 'Imp (A)': '1', 'Voc (V)': '50', 'Isc (A)': '2' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vmp must not exceed Voc');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('deletes a panel type after confirming', async () => {
    const { sent, onSaved, restore: r } = renderList(() => ({ status: 200, data: { success: true } }));
    restore = r;

    await userEvent.click(screen.getByRole('button', { name: 'Delete Longi 450W' }));

    expect(sent).toHaveLength(0);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete the panel type “Longi 450W”?' })).getByRole('button', { name: 'Delete' }));
    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/api/panel-types/1');
    expect(onSaved).toHaveBeenCalled();
  });

  it('invites adding the first panel type when there are none', () => {
    restore = renderList(() => ({ status: 200 }), []).restore;

    expect(screen.getByText('No panel types yet. Add the one on your roof from its datasheet.')).toBeInTheDocument();
  });
});
