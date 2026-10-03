import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import DevSerialSniff from './DevSerialSniff';

const frame = (seq: number, words: number[], hex: string) => ({
  seq, receivedAt: '2026-10-03T12:00:00.000Z', unit: 1, func: 3, byteCount: words.length * 2, words, hex,
});

function renderPage(handler: (method: string, url: string, body: unknown) => Reply) {
  const server = fakeServer((config) =>
    handler(config.method ?? 'get', config.url ?? '', config.data ? JSON.parse(config.data) : undefined),
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

  it('starts a capture on the configured port and lists frames without naming registers', async () => {
    let running = false;
    const server = renderPage((method, url) => {
      if (method === 'post' && url === '/api/dev/serial/start') running = true;
      if (method === 'get') {
        const since = Number(new URLSearchParams(url.split('?')[1]).get('since'));
        const frames = running ? [frame(1, [2300], '01 03 02 08 fc bf c5'), frame(2, [20, 50], '01 03 04 00 14 00 32 3b e2')] : [];
        return { status: 200, data: { running, path: '/dev/cu.usbserial-1', error: null, defaultPath: '/dev/cu.usbserial-1', frames: frames.filter((f) => f.seq > since) } };
      }
      return { status: 201, data: { running, path: '/dev/cu.usbserial-1', error: null } };
    });
    restore = server.restore;

    expect(await screen.findByLabelText('Serial port')).toHaveValue('/dev/cu.usbserial-1');
    expect(screen.getByText(/receive-only/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start capture' }));

    const rows = await screen.findAllByRole('row');
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3)); // header + 2 frames
    expect(within(rows[0]).getByText('#')).toBeInTheDocument();
    expect(screen.getByText('01 03 04 00 14 00 32 3b e2')).toBeInTheDocument();
    expect(screen.getByText('20, 50')).toBeInTheDocument();
    expect(screen.queryByText(/register/i)).toBeNull();

    const start = server.sent.find((c) => c.url === '/api/dev/serial/start');
    expect(JSON.parse(start?.data)).toEqual({ path: '/dev/cu.usbserial-1' });
    // Polls only for frames it has not seen yet.
    await waitFor(() => expect(server.sent.some((c) => c.url === '/api/dev/serial?since=2')).toBe(true));
  });

  it('attaches a note to a frame', async () => {
    const server = renderPage((method) =>
      method === 'get'
        ? { status: 200, data: { running: true, path: '/dev/cu.a', error: null, defaultPath: null, frames: [frame(1, [2300], '01 03 02 08 fc bf c5')] } }
        : { status: 204 },
    );
    restore = server.restore;

    await userEvent.type(await screen.findByLabelText('Note for frame 1'), 'app shows 230 V');
    await userEvent.click(screen.getByRole('button', { name: 'Save note for frame 1' }));

    const note = server.sent.find((c) => c.url === '/api/dev/serial/frames/1/note');
    expect(JSON.parse(note?.data)).toEqual({ note: 'app shows 230 V' });
  });

  it('explains how to turn the sniffer on when the server has it off', async () => {
    restore = renderPage(() => ({ status: 404, data: { message: 'Not Found' } })).restore;

    expect(await screen.findByText(/DEV_SERIAL_SNIFF=true/)).toBeInTheDocument();
  });
});
