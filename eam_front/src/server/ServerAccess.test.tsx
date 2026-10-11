import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import ServerAccess from './ServerAccess';

const users = [
  { id: 1, email: 'owner@example.com', owner: true, viewer: false },
  { id: 2, email: 'reader@example.com', owner: false, viewer: true },
  { id: 3, email: 'guest@example.com', owner: false, viewer: false },
];

function renderAccess(put: { status: number; data?: unknown } = { status: 200 }) {
  const server = fakeServer((config) => (config.method === 'put' ? put : { status: 200, data: users }));
  render(<ServerAccess />);
  return server;
}

describe('ServerAccess', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('lists every account with whether it may look at the server page', async () => {
    restore = renderAccess().restore;
    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'owner@example.com may look at the server page' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'reader@example.com may look at the server page' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'guest@example.com may look at the server page' })).toHaveAttribute('aria-checked', 'false');
  });

  it('lets someone look', async () => {
    const server = renderAccess();
    restore = server.restore;
    await userEvent.click(await screen.findByRole('switch', { name: 'guest@example.com may look at the server page' }));
    const put = server.sent.find((c) => c.method === 'put');
    expect(put?.url).toBe('/api/server/users/3');
    expect(JSON.parse(put?.data)).toEqual({ viewer: true });
    expect(screen.getByRole('switch', { name: 'guest@example.com may look at the server page' })).toHaveAttribute('aria-checked', 'true');
  });

  it('puts the switch back when the change fails', async () => {
    restore = renderAccess({ status: 500, data: { message: 'boom' } }).restore;
    await userEvent.click(await screen.findByRole('switch', { name: 'guest@example.com may look at the server page' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'guest@example.com may look at the server page' })).toHaveAttribute('aria-checked', 'false');
  });
});
