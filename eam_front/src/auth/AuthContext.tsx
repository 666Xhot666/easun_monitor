import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import axios, { AUTH_TOKEN_STORAGE_KEY } from '../lib/apiClient';
import { AuthContext, type AuthContextValue } from './context';
import type { AuthResponse, AuthUser } from './types';

async function fetchCurrentUser(): Promise<AuthUser> {
  const { data } = await axios.get<AuthUser>('/api/auth/me');
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
      if (token) {
        try {
          const me = await fetchCurrentUser();
          if (!cancelled) setUser(me);
        } catch {
          // Token was present but rejected (expired/invalid/account
          // gone) — apiClient's response interceptor already tries a
          // silent refresh first for a 401; if we ended up here, that
          // failed too, so treat this as logged out.
          localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
          if (!cancelled) setUser(null);
        } finally {
          if (!cancelled) setIsLoading(false);
        }
        return;
      }

      // No cached access token (fresh browser, or a previous tab
      // cleared it) — the httpOnly refresh cookie may still be valid
      // from an earlier session, so try to silently mint a new access
      // token before deciding the user is logged out. This is what
      // lets a session survive a page reload without re-prompting for
      // a password every JWT_EXPIRES_IN.
      try {
        const { data } = await axios.post<{ accessToken: string }>(
          '/api/auth/refresh',
        );
        localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, data.accessToken);
        const me = await fetchCurrentUser();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyAuthResponse = useCallback(async (auth: AuthResponse) => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, auth.accessToken);
    const me = await fetchCurrentUser();
    setUser(me);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await axios.post<AuthResponse>('/api/auth/login', {
        email,
        password,
      });
      await applyAuthResponse(data);
    },
    [applyAuthResponse],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const { data } = await axios.post<AuthResponse>('/api/auth/register', {
        email,
        password,
      });
      await applyAuthResponse(data);
    },
    [applyAuthResponse],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    setUser(null);
    // Best-effort — local session state is already cleared either way,
    // but this revokes the refresh cookie server-side too, so a
    // copied/leaked cookie can't be used to mint new access tokens
    // after the user has logged out.
    void axios.post('/api/auth/logout').catch(() => {});
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await fetchCurrentUser();
    setUser(me);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      hasInverterProfile: (user?.inverterProfiles.length ?? 0) > 0,
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, isLoading, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
