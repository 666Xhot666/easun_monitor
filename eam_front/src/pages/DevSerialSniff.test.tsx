import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import DevSerialSniff from './DevSerialSniff';

const registers = [
  { name: 'OutputPriority', label: 'Output source priority', address: 301, type: 'uint16', group: 'settings', writable: true, options: ['UTI', 'SOL', 'SBU', 'SUB'] },
];
const port = (path: string, baudRate: number, state = 'open') => ({ path, baudRate, state, error: null, reconnects: 0 });
const idle = {
  running: false,
  captureId: null,
  ports: { rx: null, tx: null },
  skippedWrites: 0,
  defaults: { rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx', rxBaud: 9600, txBaud: 115200 },
  records: [],
};
const pair = {
  seq: 3, kind: 'pair', requestAt: 1_000, responseAt: 1_040,
  request: { unit: 1, func: 3, address: 301, quantity: 1, hex: '01 03 01 2d 00 01 15 ff' },
  response: { unit: 1, func: 3, byteCount: 2, words: [2], hex: '01 03 02 00 02 39 85' },
};
const summary = {
  meta: { id: 'cap-1', startedAt: '2026-10-03T12:00:00.000Z', rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx' },
  counts: { pairs: 40, plausible: 18, implausible: 1, unknown: 2, unanswered: 1, orphan: 0, reconnects: 1 },
  addresses: [
    { address: 301, name: 'OutputPriority', latestValue: 2, category: 'plausible', seen: 20, lastSeenAt: 1_040 },
    { address: 302, name: 'InputVoltageRange', latestValue: 9, category: 'implausible', reason: 'not one of its 3 options', seen: 20, lastSeenAt: 1_040 },
    { address: 344, name: null, latestValue: 7, category: 'unknown', seen: 3, lastSeenAt: 1_040 },
  ],
  unanswered: [{ address: 322, quantity: 22, count: 1 }],
};

function renderPage(handler: (method: string, url: string, body: unknown) => Reply) {
  const server = fakeServer((config) =>
    config.url === '/api/inverter/registers'
      ? { status: 200, data: registers }
      : handler(config.method ?? 'get', config.url ?? '', config.data ? JSON.parse(config.data) : undefined),
  );
  render(
    <MemoryRouter>
      <DevSerialSniff pollMs={20} />
    </MemoryRouter>,
  );
  return server;
}

describe('DevSerialSniff page', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('starts a two-port capture with the configured ports and shows paired reads live', async () => {
    let running = false;
    const server = renderPage((method, url) => {
      if (method === 'post' && url === '/api/dev/serial/start') running = true;
      if (url === '/api/dev/serial/captures') return { status: 200, data: [] };
      const status = running
        ? { ...idle, running, captureId: 'cap-1', ports: { rx: port('/dev/cu.rx', 9600), tx: port('/dev/cu.tx', 115200) } }
        : idle;
      if (method === 'get') {
        const since = Number(new URLSearchParams(url.split('?')[1]).get('since'));
        return { status: 200, data: { ...status, records: running ? [pair].filter((r) => r.seq > since) : [] } };
      }
      return { status: 201, data: status };
    });
    restore = server.restore;

    expect(await screen.findByLabelText('Response port (RX)')).toHaveValue('/dev/cu.rx');
    expect(screen.getByLabelText('Request port (TX)')).toHaveValue('/dev/cu.tx');
    expect(screen.getByLabelText('TX baud')).toHaveValue(115200);
    await userEvent.click(screen.getByRole('button', { name: 'Start capture' }));

    expect(await screen.findByText('01 03 02 00 02 39 85')).toBeInTheDocument();
    const row = screen.getByText('01 03 02 00 02 39 85').closest('tr')!;
    expect(within(row).getByText('301 ×1')).toBeInTheDocument();
    expect(within(row).getByText('OutputPriority = SBU')).toBeInTheDocument();

    const start = server.sent.find((c) => c.url === '/api/dev/serial/start');
    expect(JSON.parse(start?.data)).toEqual({ rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx', rxBaud: 9600, txBaud: 115200 });
    await waitFor(() => expect(server.sent.some((c) => c.url === '/api/dev/serial?since=3')).toBe(true));
  });

  it('shows a port that is reconnecting', async () => {
    restore = renderPage((_method, url) =>
      url === '/api/dev/serial/captures'
        ? { status: 200, data: [] }
        : {
            status: 200,
            data: {
              ...idle,
              running: true,
              captureId: 'cap-1',
              ports: { rx: port('/dev/cu.rx', 9600), tx: { ...port('/dev/cu.tx', 115200, 'reconnecting'), error: 'returned no data', reconnects: 2 } },
            },
          },
    ).restore;

    expect(await screen.findByText(/TX: reconnecting \(returned no data\), 2 reconnects/)).toBeInTheDocument();
  });

  it('summarises a past capture: counts per category and one row per address', async () => {
    const server = renderPage((_method, url) =>
      url === '/api/dev/serial/captures'
        ? { status: 200, data: [summary.meta] }
        : url.startsWith('/api/dev/serial/captures/cap-1/summary')
          ? { status: 200, data: summary }
          : { status: 200, data: idle },
    );
    restore = server.restore;

    await userEvent.click(await screen.findByRole('tab', { name: 'Summary' }));
    await userEvent.selectOptions(await screen.findByLabelText('Capture'), 'cap-1');
    await userEvent.clear(screen.getByLabelText('Battery voltage'));
    await userEvent.type(screen.getByLabelText('Battery voltage'), '24');
    await userEvent.click(screen.getByRole('button', { name: 'Summarise' }));

    const counts = await screen.findByRole('list', { name: 'Counts' });
    expect(within(counts).getByText('Implausible: 1')).toBeInTheDocument();
    expect(within(counts).getByText('Unknown: 2')).toBeInTheDocument();
    expect(within(counts).getByText('Unanswered: 1')).toBeInTheDocument();
    const implausible = screen.getByText('InputVoltageRange').closest('tr')!;
    expect(within(implausible).getByText('not one of its 3 options')).toBeInTheDocument();
    expect(screen.getByText('344').closest('tr')).toHaveTextContent('unknown');
    expect(screen.getByText('322 ×22')).toBeInTheDocument();
    expect(server.sent.some((c) => c.url === '/api/dev/serial/captures/cap-1/summary?batteryVoltage=24')).toBe(true);
  });

  it('explains how to turn the capture on when the server has it off', async () => {
    restore = renderPage(() => ({ status: 404, data: { message: 'Not Found' } })).restore;
    expect(await screen.findByText(/DEV_SERIAL_SNIFF=true/)).toBeInTheDocument();
  });
});
