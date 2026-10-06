import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import { fakeServer, type Reply } from '../test/fakeServer';
import JoinPage from './JoinPage';

function renderJoin(auth: Partial<AuthContextValue>, handler: () => Reply = () => ({ status: 201, data: {} })) {
  const server = fakeServer(handler);
  render(
    <AuthContext.Provider value={auth as AuthContextValue}>
      <MemoryRouter initialEntries={['/join/K7Q2-9XPA']}>
        <Routes>
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="/dashboard" element={<p>Dashboard page</p>} />
          <Route path="/login" element={<p>Login page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return server;
}

const signedIn = () => ({
  isLoading: false,
  isAuthenticated: true,
  user: { id: 1, email: 'me@example.com', createdAt: '', inverterProfiles: [] } as unknown as AuthContextValue['user'],
  refreshUser: vi.fn(async () => {}),
});

describe('JoinPage', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('joins the household with the code when signed in, then opens the dashboard', async () => {
    const auth = signedIn();
    const server = renderJoin(auth);
    restore = server.restore;

    expect(screen.getByText('K7Q2-9XPA')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Join household' }));

    expect(server.sent[0].url).toBe('/api/households/join');
    expect(JSON.parse(server.sent[0].data)).toEqual({ code: 'K7Q2-9XPA' });
    expect(auth.refreshUser).toHaveBeenCalled();
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
  });

  it("shows the server's reason when the code is refused", async () => {
    restore = renderJoin(signedIn(), () => ({ status: 400, data: { statusCode: 400, message: 'This invite code is not valid' } })).restore;

    await userEvent.click(screen.getByRole('button', { name: 'Join household' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This invite code is not valid');
  });

  it('creates an account that joins with the code when signed out', async () => {
    const register = vi.fn(async () => {});
    restore = renderJoin({ isLoading: false, isAuthenticated: false, user: null, register }).restore;

    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }));

    expect(register).toHaveBeenCalledWith('new@example.com', 'correct-horse-battery', 'K7Q2-9XPA');
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
  });

  it('offers signing in first for an existing account, coming back here', async () => {
    restore = renderJoin({ isLoading: false, isAuthenticated: false, user: null, register: vi.fn() }).restore;

    await userEvent.click(screen.getByRole('link', { name: 'Sign in with an existing account' }));

    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});
