import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import { fakeServer } from '../test/fakeServer';
import HouseholdPage from './HouseholdPage';

function renderPage(adminHouseholdId: number | null) {
  const restore = fakeServer((config) =>
    config.url === '/api/households/5/members' || config.url === '/api/households/5/invites'
      ? { status: 200, data: [] }
      : { status: 404 },
  ).restore;
  const auth = {
    user: {
      id: 1,
      email: 'me@example.com',
      adminHouseholdId,
      households: [
        { id: 5, name: 'Home', role: adminHouseholdId === 5 ? 'ADMIN' : 'READER' },
        { id: 8, name: 'Parents', role: 'READER' },
      ],
      inverterProfiles: [],
    },
  } as unknown as AuthContextValue;
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/dashboard/7/household']}>
        <Routes>
          <Route path="/dashboard/:profileId/household" element={<HouseholdPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return restore;
}

describe('HouseholdPage', () => {
  let restore = () => {};
  afterEach(() => restore());

  it("lists the user's households with their role", () => {
    restore = renderPage(null);

    expect(screen.getByRole('heading', { name: 'Household' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Home' })).toHaveTextContent('Reader');
    expect(screen.getByRole('listitem', { name: 'Parents' })).toHaveTextContent('Reader');
    expect(screen.getByRole('link', { name: '← Dashboard' })).toHaveAttribute('href', '/dashboard/7');
  });

  it('lets an admin manage the members and invites of their household', async () => {
    restore = renderPage(5);

    expect(screen.getByRole('listitem', { name: 'Home' })).toHaveTextContent('Admin');
    expect(await screen.findByRole('button', { name: 'Create invite' })).toBeInTheDocument();
  });

  it('offers no member management to a user who only reads', () => {
    restore = renderPage(null);

    expect(screen.queryByRole('button', { name: 'Create invite' })).not.toBeInTheDocument();
  });
});
