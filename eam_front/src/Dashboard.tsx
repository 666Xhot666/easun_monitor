import { useEffect, useState } from 'react';
import axios from 'axios';
import HistoryChart from './HistoryChart';

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

export default function Dashboard() {
  const [reading, setReading] = useState<InverterLog | null>(null);
  // True only until the *first* request settles (success or failure) —
  // after that we always have either data or a known error state to show,
  // so we never need to blank the whole page again.
  const [loading, setLoading] = useState(true);
  const [fetchState, setFetchState] = useState<FetchState>('ok');

  // Defined inside the effect (rather than a component-scope useCallback)
  // so the polling loop is entirely self-contained: no dependency array to
  // keep in sync, and a `cancelled` guard means a request that resolves
  // after the component has unmounted (e.g. the interval firing right as
  // you navigate away) silently no-ops instead of writing to dead state.
  useEffect(() => {
    let cancelled = false;

    async function fetchLatest() {
      try {
        const { data } = await axios.get<InverterLog>('/api/inverter/latest');
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

    fetchLatest();
    const intervalId = setInterval(fetchLatest, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

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
            Waiting for the first poll from the inverter — checking again every {POLL_INTERVAL_MS / 1000}s.
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
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            EAM
          </h1>
          <div className="flex items-center gap-3 text-sm">
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
          </div>
        </div>
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

        <HistoryChart />

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
