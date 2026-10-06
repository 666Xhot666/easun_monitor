import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import SetupWizard from './SetupWizard';

function renderWizard(adminHouseholdId: number | null) {
  const auth = {
    user: { id: 1, email: 'me@example.com', adminHouseholdId, households: [], inverterProfiles: [] },
    refreshUser: vi.fn(),
  } as unknown as AuthContextValue;
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <SetupWizard />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('SetupWizard', () => {
  it('pairs an inverter for a user with a household of their own', () => {
    renderWizard(5);

    expect(screen.queryByText(/Only a household admin can add inverters/)).not.toBeInTheDocument();
  });

  it('tells an invited user that only household admins add inverters', () => {
    renderWizard(null);

    expect(
      screen.getByText('Only a household admin can add inverters. Ask an admin of your household to add one.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});
