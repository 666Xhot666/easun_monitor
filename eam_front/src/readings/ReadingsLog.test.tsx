import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import type { RegisterDefinition } from '../inverter/types';
import ReadingsLog from './ReadingsLog';
import { dayRange } from './days';

const registers: RegisterDefinition[] = [
  { name: 'OperationMode', label: 'Operating mode', address: 201, type: 'uint16', group: 'telemetry', options: ['Power on', 'Standby', 'Mains'] },
  { name: 'MainsVoltage', label: 'Mains voltage', address: 202, type: 'int16', scale: 0.1, unit: 'V', group: 'telemetry' },
  { name: 'PVPower', label: 'PV power', address: 223, type: 'int16', unit: 'W', group: 'telemetry' },
];

const TODAY = '2026-10-06';
/** A reading at a local time on a day. */
const reading = (day: string, time: string, payload: Record<string, number>, id = 1) => ({
  id,
  timestamp: new Date(`${day}T${time}`).toISOString(),
  payload,
});

function renderLog(handler: (params: Record<string, string>) => Reply) {
  const server = fakeServer((config: InternalAxiosRequestConfig) =>
    config.url === '/api/inverter/7/readings' ? handler(config.params) : { status: 404 },
  );
  render(<ReadingsLog profileId={7} registers={registers} today={TODAY} />);
  return server;
}

describe('ReadingsLog', () => {
  let restore = () => {};
  afterEach(() => restore());

  it("lists today's readings, newest first, with named and formatted values", async () => {
    const server = renderLog(() => ({
      status: 200,
      data: [
        reading(TODAY, '07:17:34', { OperationMode: 2, MainsVoltage: 231.4, PVPower: 0 }, 2),
        reading(TODAY, '07:17:04', { OperationMode: 2, PVPower: 12 }, 1),
      ],
    }));
    restore = server.restore;

    const list = await screen.findByRole('list', { name: 'Readings' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('07:17:34')).toBeInTheDocument();
    expect(within(items[0]).getByText('Operating mode')).toBeInTheDocument();
    expect(within(items[0]).getByText('Mains')).toBeInTheDocument();
    expect(within(items[0]).getByText('231.4 V')).toBeInTheDocument();
    expect(within(items[1]).getByText('12 W')).toBeInTheDocument();
    expect(within(items[1]).queryByText('Mains voltage')).not.toBeInTheDocument();

    expect(server.sent[0].params).toEqual({ ...dayRange(TODAY), limit: 100 });
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
  });

  it('switches days with Yesterday, the arrows and the date picker', async () => {
    const server = renderLog(() => ({ status: 200, data: [] }));
    restore = server.restore;
    await screen.findByText('No readings on this day.');

    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(await screen.findByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
    expect(server.sent.at(-1)?.params.from).toBe(dayRange('2026-10-05').from);

    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByRole('heading', { name: 'Sun, 4 Oct 2026' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(await screen.findByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();

    // A date picker reports whole dates, never partly typed ones.
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-09-30' } });
    expect(await screen.findByRole('heading', { name: 'Wed, 30 Sep 2026' })).toBeInTheDocument();
    expect(server.sent.at(-1)?.params.from).toBe(dayRange('2026-09-30').from);

    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
  });

  it('loads older readings of the day a page at a time', async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) =>
      reading(TODAY, `10:${String(59 - Math.floor(i / 60)).padStart(2, '0')}:${String(59 - (i % 60)).padStart(2, '0')}`, { PVPower: i }, 1000 - i),
    );
    const server = renderLog((params) => ({
      status: 200,
      data: params.before ? [reading(TODAY, '09:00:00', { PVPower: 999 }, 1)] : firstPage,
    }));
    restore = server.restore;

    await screen.findByText('10:59:59');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('09:00:00')).toBeInTheDocument();
    expect(server.sent.at(-1)?.params.before).toBe(firstPage[99].timestamp);
    expect(screen.getAllByRole('listitem')).toHaveLength(101);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it("says so when the readings can't be loaded", async () => {
    restore = renderLog(() => ({ status: 500 })).restore;

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the readings.");
  });
});
