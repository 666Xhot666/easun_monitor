import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import { AuthProvider } from './AuthContext';
import { useAuth } from './useAuth';

const me = { id: 1, email: 'owner@example.com', createdAt: '2026-01-01', inverterProfiles: [] };

function Probe() {
  const { user, isLoading, logoutEverywhere } = useAuth();
  if (isLoading) return <p>loading</p>;
  return (
    <div>
      <p>{user ? `signed in as ${user.email}` : 'signed out'}</p>
      <button onClick={() => void logoutEverywhere()}>everywhere</button>
    </div>
  );
}

describe('AuthProvider', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('restores the session from the refresh cookie on load', async () => {
    const server = fakeServer((config) =>
      config.url === '/api/auth/refresh'
        ? { status: 200, data: { accessToken: 't1' } }
        : { status: 200, data: me },
    );
    restore = server.restore;

    render(<AuthProvider><Probe /></AuthProvider>);

    expect(await screen.findByText('signed in as owner@example.com')).toBeInTheDocument();
  });

  it('signs out on every device', async () => {
    const server = fakeServer((config) =>
      config.url === '/api/auth/refresh'
        ? { status: 200, data: { accessToken: 't1' } }
        : config.url === '/api/auth/logout-all'
          ? { status: 204 }
          : { status: 200, data: me },
    );
    restore = server.restore;
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('signed in as owner@example.com');

    await act(async () => screen.getByText('everywhere').click());

    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());
    const call = server.sent.find((c) => c.url === '/api/auth/logout-all');
    expect(call?.method).toBe('post');
    expect(call?.headers.get('Authorization')).toBe('Bearer t1');
  });

  describe('dev-mode auto-login', () => {
    const noSession = (devLogin: { status: number; data?: unknown }) =>
      fakeServer((config) =>
        config.url === '/api/auth/refresh'
          ? { status: 401, data: { message: 'No refresh token provided' } }
          : config.url === '/api/auth/dev-login'
            ? devLogin
            : { status: 200, data: me },
      );

    it('signs in through dev-login when there is no session to restore', async () => {
      const server = noSession({ status: 200, data: { accessToken: 'dev', user: me } });
      restore = server.restore;

      render(<AuthProvider devAutoLogin><Probe /></AuthProvider>);

      expect(await screen.findByText('signed in as owner@example.com')).toBeInTheDocument();
      expect(server.sent.find((c) => c.url === '/api/auth/me')?.headers.get('Authorization')).toBe('Bearer dev');
    });

    it('stays signed out when the server has dev-login turned off', async () => {
      restore = noSession({ status: 404, data: { message: 'Not Found' } }).restore;

      render(<AuthProvider devAutoLogin><Probe /></AuthProvider>);

      expect(await screen.findByText('signed out')).toBeInTheDocument();
    });

    it('never tries dev-login outside dev builds', async () => {
      const server = noSession({ status: 200, data: { accessToken: 'dev', user: me } });
      restore = server.restore;

      render(<AuthProvider devAutoLogin={false}><Probe /></AuthProvider>);

      expect(await screen.findByText('signed out')).toBeInTheDocument();
      expect(server.sent.some((c) => c.url === '/api/auth/dev-login')).toBe(false);
    });
  });
});
