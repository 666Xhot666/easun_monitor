import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import axios from 'axios';
import HistoryChart from './HistoryChart';
import { useAuth } from './auth/useAuth';
import { extractErrorMessage } from './lib/errors';
import type { InverterProfile } from './auth/types';

interface InverterLog {
  id: number;
  timestamp: string;
  payload: Record<string, number>;
}

interface KeyMetricConfig {
  key: string;
  label: string;
  unit: string;
  decimals: number;
}

const POLL_INTERVAL_MS = 5000;

// The four headline metrics, pulled out of the payload and shown as large
// cards above the full parameter grid. Everything else currently in the
// payload (~80 more fields from commands.json) renders generically below,
// so this list doesn't need to be kept in sync with the backend's register
// map — only these four get special treatment.
const KEY_METRICS: KeyMetricConfig[] = [
  { key: 'LineVoltage', label: 'Grid Voltage', unit: 'V', decimals: 1 },
  { key: 'BatteryVoltage', label: 'Battery Voltage', unit: 'V', decimals: 1 },
  { key: 'PVPower', label: 'PV Power', unit: 'W', decimals: 0 },
  { key: 'BatterySoc', label: 'Battery SoC', unit: '%', decimals: 0 },
];

const KEY_METRIC_NAMES = new Set(KEY_METRICS.map((metric) => metric.key));

function formatValue(value: unknown, decimals = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return String(value);
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

type FetchState = 'ok' | 'no-data' | 'unreachable';

function ProfileSwitcher({
  profiles,
  activeProfileId,
  onDelete,
}: {
  profiles: InverterProfile[];
  activeProfileId: number;
  onDelete: (id: number) => void;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5">
      {profiles.map((profile) => {
        const isActive = profile.id === activeProfileId;
        return (
          <span
            key={profile.id}
            className={
              'group inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition ' +
              (isActive
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700')
            }
          >
            <Link to={`/dashboard/${profile.id}`}>{profile.name}</Link>
            {profiles.length > 1 && (
              <button
                type="button"
                onClick={() => onDelete(profile.id)}
                aria-label={`Remove ${profile.name}`}
                title={`Remove ${profile.name}`}
                className={
                  'ml-0.5 rounded-full px-1 leading-none opacity-60 transition hover:opacity-100 ' +
                  (isActive ? 'hover:bg-blue-700' : 'hover:bg-gray-300 dark:hover:bg-gray-600')
                }
              >
                ×
              </button>
            )}
          </span>
        );
      })}
      <Link
        to="/setup"
        className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs font-medium text-gray-500 transition hover:border-gray-400 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        + Add inverter
      </Link>
    </nav>
  );
}

export default function Dashboard() {
  const { user, logout, refreshUser } = useAuth();
  const { profileId: profileIdParam } = useParams<{ profileId: string }>();
  const navigate = useNavigate();

  const profiles = user?.inverterProfiles ?? [];
  const requestedId = Number(profileIdParam);
  const activeProfile = profiles.find((p) => p.id === requestedId) ?? profiles[0] ?? null;

  // The URL's :profileId might be stale (bad id, or one that was just
  // deleted) — if so, and the user still has at least one paired
  // inverter, land on that one instead of a dead end. If none are left,
  // RequireInverterProfile (the parent route guard) sends us to /setup
  // on its own once `user` updates, so nothing extra is needed here for
  // that case.
  useEffect(() => {
    if (activeProfile && activeProfile.id !== requestedId) {
      navigate(`/dashboard/${activeProfile.id}`, { replace: true });
    }
  }, [activeProfile, requestedId, navigate]);

  const [reading, setReading] = useState<InverterLog | null>(null);
  // True only until the *first* request settles (success or failure) —
  // after that we always have either data or a known error state to show,
  // so we never need to blank the whole page again.
  const [loading, setLoading] = useState(true);
  const [fetchState, setFetchState] = useState<FetchState>('ok');
  const [switcherError, setSwitcherError] = useState<string | null>(null);

  // Defined inside the effect (rather than a component-scope useCallback)
  // so the polling loop is entirely self-contained: no dependency array to
  // keep in sync, and a `cancelled` guard means a request that resolves
  // after the component has unmounted (e.g. the interval firing right as
  // you navigate away) silently no-ops instead of writing to dead state.
  useEffect(() => {
    if (!activeProfile) return;
    const profileId = activeProfile.id;
    let cancelled = false;

    // `isInitial` distinguishes the first fetch for this profile (which
    // should show the "Loading inverter data…" screen) from every
    // background poll tick after it (which should just swap `reading` in
    // place once new data arrives). Without this distinction, every 5s
    // tick was calling setLoading(true) unconditionally — bouncing the
    // whole dashboard back to the loading screen and then to the real
    // content again on every single poll, which is what read as the page
    // "blinking".
    async function fetchLatest(isInitial: boolean) {
      if (cancelled) return;
      if (isInitial) {
        setLoading(true);
        setReading(null);
      }
      try {
        const { data } = await axios.get<InverterLog>(`/api/inverter/${profileId}/latest`);
        if (cancelled) return;
        setReading(data);
        setFetchState('ok');
      } catch (error) {
        if (cancelled) return;
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          // Backend is up, but the poller hasn't written a row yet (e.g.
          // right after a fresh deploy) — different from not being able
          // to reach the API at all, so the UI says something different.
          setFetchState('no-data');
        } else {
          // Network error, timeout, 5xx, connection refused, etc. — keep
          // whatever `reading` is already on screen (see render below)
          // instead of blanking the dashboard on every brief hiccup.
          setFetchState('unreachable');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLatest(true);
    const intervalId = setInterval(() => fetchLatest(false), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [activeProfile]);

  async function handleDeleteProfile(id: number) {
    if (!window.confirm('Remove this inverter? Its recorded history is kept.')) {
      return;
    }
    setSwitcherError(null);
    try {
      await axios.delete(`/api/inverter/profiles/${id}`);
      await refreshUser();
    } catch (error) {
      setSwitcherError(extractErrorMessage(error, "Couldn't remove that inverter."));
    }
  }

  if (!activeProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-gray-500 dark:text-gray-400">Loading inverter data…</p>
      </div>
    );
  }

  if (fetchState === 'no-data') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 text-center dark:bg-gray-950">
        <div>
          <p className="text-lg font-medium text-gray-700 dark:text-gray-200">No readings yet</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Waiting for the first poll from {activeProfile.name} — checking again every{' '}
            {POLL_INTERVAL_MS / 1000}s.
          </p>
        </div>
      </div>
    );
  }

  if (fetchState === 'unreachable' && !reading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 text-center dark:bg-gray-950">
        <div>
          <p className="text-lg font-medium text-red-600 dark:text-red-400">Can't reach the backend</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Retrying every {POLL_INTERVAL_MS / 1000}s…
          </p>
        </div>
      </div>
    );
  }

  const payload = reading?.payload ?? {};
  const remainingEntries = Object.entries(payload)
    .filter(([key]) => !KEY_METRIC_NAMES.has(key))
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">EAM</h1>
            <ProfileSwitcher
              profiles={profiles}
              activeProfileId={activeProfile.id}
              onDelete={(id) => {
                void handleDeleteProfile(id);
              }}
            />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link
              to={`/dashboard/${activeProfile.id}/settings`}
              title="Settings & Configuration"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </Link>
            {fetchState === 'unreachable' && (
              <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                Connection lost — showing last known data
              </span>
            )}
            {reading && (
              <span className="text-gray-500 dark:text-gray-400">
                Updated {formatTimestamp(reading.timestamp)}
              </span>
            )}
            <span className="text-gray-300 dark:text-gray-700">·</span>
            <span className="text-gray-500 dark:text-gray-400">{user?.email}</span>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Sign out
            </button>
          </div>
        </div>
        {switcherError && (
          <p className="mx-auto mt-2 max-w-6xl text-sm text-red-600 dark:text-red-400">
            {switcherError}
          </p>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Key metrics */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {KEY_METRICS.map((metric) => {
            const value = payload[metric.key];
            const hasValue = typeof value === 'number';
            return (
              <div
                key={metric.key}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
              >
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{metric.label}</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
                  {hasValue ? formatValue(value, metric.decimals) : '—'}
                  <span className="ml-1 text-base font-medium text-gray-400 dark:text-gray-500">
                    {hasValue ? metric.unit : ''}
                  </span>
                </p>
              </div>
            );
          })}
        </section>

        <HistoryChart profileId={activeProfile.id} />

        {/* Every other parameter in the payload */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            All parameters ({remainingEntries.length})
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {remainingEntries.map(([key, value]) => (
              <div
                key={key}
                className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
              >
                <p className="truncate text-xs font-medium text-gray-500 dark:text-gray-400" title={key}>
                  {key}
                </p>
                <p className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
                  {formatValue(value)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
