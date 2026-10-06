import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import axios, { clearAccessToken, setAccessToken } from '../lib/apiClient';
import { AuthContext, type AuthContextValue } from './context';
import type { AuthResponse, AuthUser } from './types';

async function fetchCurrentUser(): Promise<AuthUser> {
  const { data } = await axios.get<AuthUser>('/api/auth/me');
  return data;
}

/** Dev-mode auto-login; null when the server doesn't offer it (404). */
async function tryDevLogin(): Promise<AuthUser | null> {
  try {
    const { data } = await axios.get<AuthResponse>('/api/auth/dev-login');
    setAccessToken(data.accessToken);
    return await fetchCurrentUser();
  } catch {
    clearAccessToken();
    return null;
  }
}

export function AuthProvider({
  children,
  devAutoLogin = import.meta.env.DEV,
}: {
  children: ReactNode;
  /** Try GET /api/auth/dev-login when no session can be restored. The
   * server only answers it in development with DEV_AUTO_LOGIN=true. */
  devAutoLogin?: boolean;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // The access token is memory-only, so every page load starts
      // without one: mint a fresh one from the httpOnly refresh cookie
      // (if the browser still has a valid session) before deciding the
      // user is logged out.
      try {
        const { data } = await axios.post<{ accessToken: string }>(
          '/api/auth/refresh',
        );
        setAccessToken(data.accessToken);
        const me = await fetchCurrentUser();
        if (!cancelled) setUser(me);
      } catch {
        clearAccessToken();
        const me = devAutoLogin ? await tryDevLogin() : null;
        if (!cancelled) setUser(me);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [devAutoLogin]);

  const applyAuthResponse = useCallback(async (auth: AuthResponse) => {
    setAccessToken(auth.accessToken);
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
    async (email: string, password: string, inviteCode?: string) => {
      const { data } = await axios.post<AuthResponse>('/api/auth/register', {
        email,
        password,
        ...(inviteCode && { inviteCode }),
      });
      await applyAuthResponse(data);
    },
    [applyAuthResponse],
  );

  const logout = useCallback(() => {
    clearAccessToken();
    setUser(null);
    // Best-effort — local session state is already cleared either way,
    // but this revokes the refresh cookie server-side too, so a
    // copied/leaked cookie can't be used to mint new access tokens
    // after the user has logged out.
    void axios.post('/api/auth/logout').catch(() => {});
  }, []);

  const logoutEverywhere = useCallback(async () => {
    // Must run while the access token is still held: the endpoint is
    // authenticated. Local sign-out happens even if the call fails.
    try {
      await axios.post('/api/auth/logout-all');
    } finally {
      clearAccessToken();
      setUser(null);
    }
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
      logoutEverywhere,
      refreshUser,
    }),
    [user, isLoading, login, register, logout, logoutEverywhere, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
