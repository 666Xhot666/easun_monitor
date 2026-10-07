import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import NotificationSettings from './NotificationSettings';

const settings = {
  channels: {
    fault: { inApp: true, telegram: true },
    warning: { inApp: true, telegram: true },
    grid: { inApp: true, telegram: true },
    battery: { inApp: true, telegram: true },
    connection: { inApp: true, telegram: true },
    summary: { inApp: false, telegram: true },
  },
  quietHours: false,
};

function renderSettings(linked: boolean) {
  const server = fakeServer((config) => {
    if (config.url === '/api/notifications/settings' && config.method === 'get') return { status: 200, data: settings };
    if (config.url === '/api/notifications/settings' && config.method === 'put') {
      // Like the server: the change applied over the stored settings.
      const change = JSON.parse(config.data);
      const channels = { ...settings.channels };
      for (const [kind, c] of Object.entries(change.channels ?? {})) {
        channels[kind as keyof typeof channels] = { ...channels[kind as keyof typeof channels], ...(c as object) };
      }
      return { status: 200, data: { channels, quietHours: change.quietHours ?? settings.quietHours } };
    }
    if (config.url === '/api/telegram/link') return { status: 200, data: { linked } };
    return { status: 404 };
  });
  render(<NotificationSettings />);
  return server;
}

describe('NotificationSettings', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('shows each kind with its app and Telegram switches', async () => {
    restore = renderSettings(true).restore;

    expect(await screen.findByRole('switch', { name: 'Faults in the app' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Daily summary in the app' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Grid lost and restored on Telegram' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'false');
  });

  it('saves one switch at a time', async () => {
    const server = renderSettings(true);
    restore = server.restore;

    await userEvent.click(await screen.findByRole('switch', { name: 'Grid lost and restored on Telegram' }));

    const put = server.sent.find((c) => c.method === 'put');
    expect(JSON.parse(put?.data)).toEqual({ channels: { grid: { telegram: false } } });
    expect(screen.getByRole('switch', { name: 'Grid lost and restored on Telegram' })).toHaveAttribute('aria-checked', 'false');
  });

  it('turns quiet hours on', async () => {
    const server = renderSettings(true);
    restore = server.restore;

    await userEvent.click(await screen.findByRole('switch', { name: 'Quiet hours' }));

    expect(JSON.parse(server.sent.find((c) => c.method === 'put')?.data)).toEqual({ quietHours: true });
  });

  it('shows the Telegram switches off until a chat is linked', async () => {
    restore = renderSettings(false).restore;

    const telegram = await screen.findByRole('switch', { name: 'Faults on Telegram' });
    expect(telegram).toBeDisabled();
    expect(telegram).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Link Telegram above to use these.')).toBeInTheDocument();
  });
});
