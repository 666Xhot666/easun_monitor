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
});
