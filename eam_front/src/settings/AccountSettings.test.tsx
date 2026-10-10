import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import { fakeServer, type Reply } from '../test/fakeServer';
import { ThemeProvider } from '../theme/useTheme';
import AccountSettings from './AccountSettings';

const sessions = [
  { id: 'a', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140 Safari/537.36', signedInAt: '2026-10-01T10:00:00Z', lastUsedAt: new Date().toISOString(), current: true },
  { id: 'b', userAgent: 'Mozilla/5.0 (iPhone) Version/18.0 Safari/604.1', signedInAt: '2026-10-02T10:00:00Z', lastUsedAt: '2026-10-07T10:00:00Z', current: false },
];

function renderAccount(handler: (method: string, url: string, body: unknown) => Reply) {
  const server = fakeServer((config) => handler(config.method ?? 'get', config.url ?? '', config.data ? JSON.parse(config.data) : undefined));
  const auth = { user: { email: 'jack@example.com' }, logoutEverywhere: vi.fn() } as unknown as AuthContextValue;
  render(
    <ThemeProvider>
      <AuthContext.Provider value={auth}>
        <AccountSettings />
      </AuthContext.Provider>
    </ThemeProvider>,
  );
  return server;
}

const list = (method: string, url: string): Reply | null =>
  method === 'get' && url === '/api/auth/sessions' ? { status: 200, data: sessions } : null;

describe('AccountSettings', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('lists the signed-in browsers, this one marked and the others signable out', async () => {
    const server = renderAccount((m, u) => list(m, u) ?? (m === 'delete' ? { status: 204 } : { status: 404 }));
    restore = server.restore;

    const mine = await screen.findByRole('listitem', { name: 'Chrome on macOS' });
    expect(within(mine).getByText('This device')).toBeInTheDocument();
    expect(within(mine).queryByRole('button', { name: /Sign out/ })).not.toBeInTheDocument();

    const phone = screen.getByRole('listitem', { name: 'Safari on iPhone' });
    await userEvent.click(within(phone).getByRole('button', { name: 'Sign out Safari on iPhone' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out' }));

    expect(server.sent.find((c) => c.method === 'delete')?.url).toBe('/api/auth/sessions/b');
  });

  it('changes the password', async () => {
    const server = renderAccount((m, u) => list(m, u) ?? (u === '/api/auth/password' ? { status: 204 } : { status: 404 }));
    restore = server.restore;
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Current password'), 'old-password');
    await user.type(screen.getByLabelText('New password'), 'new-long-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    const post = server.sent.find((c) => c.url === '/api/auth/password');
    expect(JSON.parse(post?.data)).toEqual({ currentPassword: 'old-password', newPassword: 'new-long-password' });
    expect(await screen.findByText('Password changed. Your other browsers are signed out.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it("shows the server's reason when the current password is wrong", async () => {
    restore = renderAccount(
      (m, u) => list(m, u) ?? (u === '/api/auth/password' ? { status: 401, data: { message: 'The current password is wrong' } } : { status: 404 }),
    ).restore;
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Current password'), 'nope');
    await user.type(screen.getByLabelText('New password'), 'new-long-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The current password is wrong');
  });
});
