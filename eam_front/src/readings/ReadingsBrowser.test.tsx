import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import type { RegisterDefinition } from '../inverter/types';
import ReadingsBrowser from './ReadingsBrowser';
import { dayRange } from './days';

const registers: RegisterDefinition[] = [
  { name: 'OperationMode', label: 'Operating mode', address: 201, type: 'uint16', group: 'telemetry', options: ['Power on', 'Standby', 'Mains'] },
  { name: 'MainsVoltage', label: 'Mains voltage', address: 202, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'PVPower', label: 'PV power', address: 223, type: 'int16', unit: 'W', group: 'telemetry' },
];

const TODAY = '2026-10-06';
const reading = (time: string, payload: Record<string, number>, id: number) => ({
  id,
  timestamp: new Date(`${TODAY}T${time}`).toISOString(),
  payload,
});

function renderBrowser(handler: (params: Record<string, string>) => Reply) {
  const server = fakeServer((config: InternalAxiosRequestConfig) =>
    config.url === '/api/inverter/7/readings' ? handler(config.params) : { status: 404 },
  );
  render(<ReadingsBrowser profileId={7} registers={registers} today={TODAY} />);
  return server;
}

describe('ReadingsBrowser', () => {
  let restore = () => {};
  afterEach(() => restore());

  it("lists the day's reading times, newest first, and shows the newest reading's values", async () => {
    const server = renderBrowser(() => ({
      status: 200,
      data: [
        reading('07:17:34', { OperationMode: 2, MainsVoltage: 231.4, PVPower: 0 }, 2),
        reading('07:17:29', { OperationMode: 1, MainsVoltage: 230.9, PVPower: 12 }, 1),
      ],
    }));
    restore = server.restore;

    const list = await screen.findByRole('listbox', { name: 'Readings' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['07:17:34', '07:17:29']);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    const detail = screen.getByRole('table', { name: /07:17:34/ });
    expect(within(detail).getByRole('row', { name: 'Operating mode Mains' })).toBeInTheDocument();
    expect(within(detail).getByRole('row', { name: 'Mains voltage 231.4 V' })).toBeInTheDocument();
    expect(server.sent[0].params).toMatchObject({ ...dayRange(TODAY), limit: 100 });
  });

  it('shows another reading when its time is picked', async () => {
    restore = renderBrowser(() => ({
      status: 200,
      data: [reading('07:17:34', { PVPower: 0 }, 2), reading('07:17:29', { PVPower: 12 }, 1)],
    })).restore;

    await userEvent.click(await screen.findByRole('option', { name: '07:17:29' }));

    expect(screen.getByRole('option', { name: '07:17:29' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('table', { name: /07:17:29/ })).getByRole('row', { name: 'PV power 12 W' })).toBeInTheDocument();
  });

  it('hides fields that are switched off', async () => {
    restore = renderBrowser(() => ({ status: 200, data: [reading('07:17:34', { OperationMode: 2, MainsVoltage: 231.4, PVPower: 0 }, 1)] })).restore;
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Fields · 3 of 3' }));
    await user.click(screen.getByRole('checkbox', { name: 'Mains voltage' }));

    expect(screen.getByRole('button', { name: 'Fields · 2 of 3' })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Mains voltage/ })).not.toBeInTheDocument();
  });

  it('pages back through a busy day with Load more', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => reading(`12:${String(59 - Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '00' : '30'}`, { PVPower: i }, 200 - i));
    const server = renderBrowser((params) =>
      params.before ? { status: 200, data: [reading('06:00:00', { PVPower: 1 }, 1)] } : { status: 200, data: page1 },
    );
    restore = server.restore;

    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('option', { name: '06:00:00' })).toBeInTheDocument();
    expect(server.sent[1].params.before).toBe(page1[99].timestamp);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('moves between days, never past today', async () => {
    const server = renderBrowser(() => ({ status: 200, data: [] }));
    restore = server.restore;

    expect(await screen.findByText('No readings on this day.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));

    expect(server.sent[1].params).toMatchObject(dayRange('2026-10-05'));
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();
  });
});
