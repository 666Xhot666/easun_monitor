import { createContext } from 'react';
import type { AuthUser } from './types';

export interface AuthContextValue {
  user: AuthUser | null;
  /** True until the initial token-verification pass has settled — route
   * guards wait on this so a logged-in user isn't flashed to /login
   * before we've had a chance to check localStorage/GET /api/auth/me. */
  isLoading: boolean;
  isAuthenticated: boolean;
  hasInverterProfile: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Re-fetches /api/auth/me — call after the setup wizard finishes so
   * `hasInverterProfile` flips without a full page reload. */
  refreshUser: () => Promise<void>;
}

// Split into its own file (rather than living in AuthContext.tsx alongside
// the AuthProvider component) purely to satisfy
// react-refresh/only-export-components — that rule requires a component
// file to export *only* components for Fast Refresh to work, and a plain
// non-component .ts file like this one is exempt entirely.
export const AuthContext = createContext<AuthContextValue | null>(null);
