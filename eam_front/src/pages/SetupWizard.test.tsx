import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import SetupWizard from './SetupWizard';

function renderWizard(adminHouseholdId: number | null, inverterCount = 0) {
  const auth = {
    user: {
      id: 1, email: 'me@example.com', adminHouseholdId,
      households: [{ id: 5, name: 'Home', role: adminHouseholdId ? 'ADMIN' : 'READER' }],
      inverterProfiles: Array.from({ length: inverterCount }, (_, i) => ({ id: i + 1 })),
    },
    refreshUser: vi.fn(),
    logout: vi.fn(),
  } as unknown as AuthContextValue;
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <SetupWizard />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return auth;
}

describe('SetupWizard', () => {
  it('pairs an inverter for a user with a household of their own', () => {
    renderWizard(5);

    expect(screen.getByRole('heading', { name: 'Pair your inverter' })).toBeInTheDocument();
    expect(screen.queryByText(/Only a household admin can add inverters/)).not.toBeInTheDocument();
  });

  it('tells an invited user with no inverter yet to wait for their admin, without sending them in circles', async () => {
    const auth = renderWizard(null);

    expect(screen.getByRole('heading', { name: 'Waiting for your admin to add an inverter' })).toBeInTheDocument();
    expect(screen.getByText(/You joined Home as a reader/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.logout).toHaveBeenCalled();
  });

  it('sends an invited user who already has inverters back to them', () => {
    renderWizard(null, 1);

    expect(
      screen.getByText('Only a household admin can add inverters. Ask an admin of your household to add one.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});
