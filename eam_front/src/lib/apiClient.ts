import axios from 'axios';

// Registered on the default axios *instance*, not a separate axios.create()
// client — Dashboard.tsx and HistoryChart.tsx already do a plain
// `import axios from 'axios'` and call it directly, and every import of
// the 'axios' module resolves to the same singleton. Mutating its
// interceptors here means those existing files automatically start
// sending the Bearer header too, with zero changes to them, instead of
// needing every call site migrated to a new named client.
export const AUTH_TOKEN_STORAGE_KEY = 'eam_auth_token';

// The refresh token travels as an httpOnly cookie the browser attaches
// automatically to same-origin requests — this only matters if the API
// is ever served from a different origin than the frontend, but costs
// nothing to set defensively now.
axios.defaults.withCredentials = true;

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

interface RetriableRequestConfig {
  _retriedAfterRefresh?: boolean;
}

// Several requests can each get a 401 back-to-back right as the access
// token expires — this makes sure they share a single in-flight
// /api/auth/refresh call instead of each kicking off their own.
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ accessToken: string }>('/api/auth/refresh')
      .then(({ data }) => {
        localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, data.accessToken);
        return data.accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function redirectToLogin() {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  // A hard navigation (not react-router's navigate) deliberately —
  // this runs outside any React component/router context, and a 401
  // means the whole in-memory app/auth state is stale anyway, so a
  // full reset is simpler and more reliable than reaching into the
  // router from an interceptor.
  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

axios.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    const config = error.config as
      | (typeof error.config & RetriableRequestConfig)
      | undefined;
    const isAuthEndpoint = (config?.url ?? '').startsWith('/api/auth/');

    // Don't attempt a refresh for: no config to retry, a 401 from an
    // auth endpoint itself (refresh calling refresh would loop, and a
    // login/register 401 means "wrong credentials", not "stale token"),
    // or a request that's already been retried once and still failed.
    if (!config || isAuthEndpoint || config._retriedAfterRefresh) {
      redirectToLogin();
      return Promise.reject(error);
    }

    try {
      config._retriedAfterRefresh = true;
      const accessToken = await refreshAccessToken();
      config.headers.set('Authorization', `Bearer ${accessToken}`);
      return axios(config);
    } catch {
      redirectToLogin();
      return Promise.reject(error);
    }
  },
);

export default axios;
