import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import TelegramLink from './TelegramLink';

function renderLink(handler: (method: string, url: string) => Reply) {
  const server = fakeServer((config) => handler(config.method ?? 'get', config.url ?? ''));
  render(<TelegramLink />);
  return server;
}

describe('TelegramLink', () => {
  let restore = () => {};
  beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true));
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('gives an unlinked user a code and tells them what to send to the bot', async () => {
    const server = renderLink((m, u) =>
      m === 'get' && u === '/api/telegram/link'
        ? { status: 200, data: { linked: false } }
        : m === 'post' && u === '/api/telegram/link-code'
          ? { status: 201, data: { code: 'ABCD2345', expiresAt: '2026-10-07T10:10:00.000Z' } }
          : { status: 404 },
    );
    restore = server.restore;

    expect(await screen.findByText('Not linked. Alerts, /status and /energy come to a linked chat.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Get a link code' }));

    expect(await screen.findByText('/start ABCD2345')).toBeInTheDocument();
    expect(screen.getByText('Send this to the bot within 10 minutes.')).toBeInTheDocument();
  });

  it('shows a linked chat and unlinks it', async () => {
    let linked = true;
    const server = renderLink((m, u) =>
      m === 'get' && u === '/api/telegram/link'
        ? { status: 200, data: { linked } }
        : m === 'delete' && u === '/api/telegram/link'
          ? ((linked = false), { status: 200, data: { success: true } })
          : { status: 404 },
    );
    restore = server.restore;

    expect(await screen.findByText('A Telegram chat is linked.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));

    expect(await screen.findByText('Not linked. Alerts, /status and /energy come to a linked chat.')).toBeInTheDocument();
    expect(server.sent.some((c) => c.method === 'delete')).toBe(true);
  });

  it('says when the server cannot be reached', async () => {
    restore = renderLink(() => ({ status: 500 })).restore;

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the Telegram link.');
  });
});
