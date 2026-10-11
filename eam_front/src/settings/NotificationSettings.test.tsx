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
    schedule: { inApp: true, telegram: true },
    outage: { inApp: true, telegram: true },
    'schedule-unavailable': { inApp: true, telegram: true },
    'server-heat': { inApp: true, telegram: true },
    'server-storage': { inApp: true, telegram: true },
    'server-memory': { inApp: true, telegram: true },
    'server-agent': { inApp: true, telegram: true },
    'server-updates': { inApp: true, telegram: true },
    summary: { inApp: false, telegram: true },
  },
  quietHours: false,
  outageLeadMinutes: 15,
  possibleOutages: false,
};

function renderSettings(linked: boolean, showServer = false) {
  const server = fakeServer((config) => {
    if (config.url === '/api/notifications/settings' && config.method === 'get') return { status: 200, data: settings };
    if (config.url === '/api/notifications/settings' && config.method === 'put') {
      // Like the server: the change applied over the stored settings.
      const change = JSON.parse(config.data);
      const channels = { ...settings.channels };
      for (const [kind, c] of Object.entries(change.channels ?? {})) {
        channels[kind as keyof typeof channels] = { ...channels[kind as keyof typeof channels], ...(c as object) };
      }
      return { status: 200, data: { ...settings, ...change, channels } };
    }
    if (config.url === '/api/telegram/link') return { status: 200, data: { linked } };
    return { status: 404 };
  });
  render(<NotificationSettings showServer={showServer} />);
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

  it('has the outage schedule notices', async () => {
    restore = renderSettings(true).restore;
    expect(await screen.findByRole('switch', { name: 'Outage schedule updated on Telegram' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Outage soon in the app' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Outage schedule unavailable on Telegram' })).toBeInTheDocument();
  });

  it('sets how long before an outage the notice comes', async () => {
    const server = renderSettings(true);
    restore = server.restore;

    const lead = await screen.findByRole('spinbutton', { name: 'Minutes before an outage' });
    expect(lead).toHaveValue(15);
    await userEvent.clear(lead);
    await userEvent.type(lead, '30');
    await userEvent.tab();

    const puts = server.sent.filter((c) => c.method === 'put').map((c) => JSON.parse(c.data));
    expect(puts).toEqual([{ outageLeadMinutes: 30 }]);
  });

  it('does not save a lead time out of range', async () => {
    const server = renderSettings(true);
    restore = server.restore;

    const lead = await screen.findByRole('spinbutton', { name: 'Minutes before an outage' });
    await userEvent.clear(lead);
    await userEvent.type(lead, '500');
    await userEvent.tab();

    expect(server.sent.filter((c) => c.method === 'put')).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent('From 1 to 120 minutes.');
  });

  it('turns the notice before possible outages on', async () => {
    const server = renderSettings(true);
    restore = server.restore;

    await userEvent.click(await screen.findByRole('switch', { name: 'Also before possible outages' }));
    expect(JSON.parse(server.sent.find((c) => c.method === 'put')?.data)).toEqual({ possibleOutages: true });
  });

  it('has the server notices for the owner and those who may look at the server', async () => {
    const server = renderSettings(true, true);
    restore = server.restore;
    await userEvent.click(await screen.findByRole('switch', { name: 'Server overheating on Telegram' }));
    expect(JSON.parse(server.sent.find((c) => c.method === 'put')?.data)).toEqual({ channels: { 'server-heat': { telegram: false } } });
    for (const name of ['Server storage low', 'Server memory short', 'Server agent silent', 'Server updates']) {
      expect(screen.getByRole('switch', { name: `${name} on Telegram` })).toBeInTheDocument();
    }
    // In the app they are on the Server page.
    expect(screen.queryByRole('switch', { name: 'Server overheating in the app' })).not.toBeInTheDocument();
  });

  it('leaves the server notices out for everyone else', async () => {
    restore = renderSettings(true).restore;
    await screen.findByRole('switch', { name: 'Faults in the app' });
    expect(screen.queryByRole('switch', { name: 'Server overheating on Telegram' })).not.toBeInTheDocument();
  });
});
