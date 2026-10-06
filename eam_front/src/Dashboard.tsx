import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ScrollText, Settings, Sun } from 'lucide-react';
import axios from './lib/apiClient';
import HistoryChart from './HistoryChart';
import { useAuth } from './auth/useAuth';
import { extractErrorMessage } from './lib/errors';
import type { InverterProfile } from './auth/types';
import { DEFAULT_POLL_MS, useReading } from './inverter/useReading';
import { describeDeviceStatus, useDeviceStatus } from './inverter/useDeviceStatus';
import { useRegisters } from './inverter/useRegisters';
import ReadingPanel from './inverter/ReadingPanel';
import EnergyFlowPanel from './energy/EnergyFlowPanel';
import EnergyTotals from './energy/EnergyTotals';
import PvArrayTile from './solar/PvArrayTile';
import { computeArray } from './solar/pvArray';
import { usePanelTypes } from './solar/usePanelTypes';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

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
  const { user, logout, logoutEverywhere, refreshUser } = useAuth();
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

  const { reading, status } = useReading(activeProfile?.id ?? 0);
  const registers = useRegisters();
  const deviceStatus = useDeviceStatus(activeProfile?.id ?? 0);
  const deviceProblem = deviceStatus ? describeDeviceStatus(deviceStatus) : null;
  const { panelTypes } = usePanelTypes();
  const panel = panelTypes?.find((t) => t.id === activeProfile?.pvPanelTypeId);
  const pvRatedW =
    panel && activeProfile?.pvPanelsInSeries && activeProfile.pvStrings
      ? computeArray(panel, { inSeries: activeProfile.pvPanelsInSeries, strings: activeProfile.pvStrings }).powerW
      : undefined;
  const [switcherError, setSwitcherError] = useState<string | null>(null);

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

  if (status === 'loading' || !registers) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-gray-500 dark:text-gray-400">Loading inverter data…</p>
      </div>
    );
  }

  if (status === 'no-data') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 text-center dark:bg-gray-950">
        <div>
          <p className="text-lg font-medium text-gray-700 dark:text-gray-200">No readings yet</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Waiting for the first poll from {activeProfile.name} — checking again every{' '}
            {DEFAULT_POLL_MS / 1000}s.
          </p>
          {deviceProblem && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{deviceProblem}</p>
          )}
        </div>
      </div>
    );
  }

  if (status === 'unreachable' && !reading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 text-center dark:bg-gray-950">
        <div>
          <p className="text-lg font-medium text-red-600 dark:text-red-400">Can't reach the backend</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Retrying every {DEFAULT_POLL_MS / 1000}s…
          </p>
        </div>
      </div>
    );
  }

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
              to={`/dashboard/${activeProfile.id}/solar`}
              title="Solar panels and how they are wired"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Sun className="h-3.5 w-3.5" />
              Solar
            </Link>
            <Link
              to={`/dashboard/${activeProfile.id}/logs`}
              title="Every reading, by day, with CSV export"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ScrollText className="h-3.5 w-3.5" />
              Logs
            </Link>
            <Link
              to={`/dashboard/${activeProfile.id}/settings`}
              title="Settings & Configuration"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </Link>
            {status === 'unreachable' && (
              <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                Connection lost — showing last known data
              </span>
            )}
            {status === 'stale' && (
              <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                No new readings from the inverter
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
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Sign out on every device and browser?')) {
                  void logoutEverywhere();
                }
              }}
              className="text-xs text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
            >
              Everywhere
            </button>
          </div>
        </div>
        {deviceProblem && (
          <p className="mx-auto mt-2 max-w-6xl text-sm text-amber-700 dark:text-amber-300">
            {deviceProblem}
            {deviceStatus?.lastSuccessAt &&
              ` Last successful read ${new Date(deviceStatus.lastSuccessAt).toLocaleString()}.`}
          </p>
        )}
        {switcherError && (
          <p className="mx-auto mt-2 max-w-6xl text-sm text-red-600 dark:text-red-400">
            {switcherError}
          </p>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8 grid items-center gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <EnergyFlowPanel reading={reading} pollMs={DEFAULT_POLL_MS} pvRatedW={pvRatedW} />
          </div>
          <div className="space-y-6">
            {panelTypes && (
              <PvArrayTile profileId={activeProfile.id} profile={activeProfile} panelTypes={panelTypes} reading={reading} />
            )}
            <EnergyTotals profileId={activeProfile.id} />
          </div>
        </div>
        {reading && (
          <ReadingPanel
            registers={registers}
            reading={reading}
            onExitFaultMode={async () => {
              try {
                await axios.post(`/api/inverter/${activeProfile.id}/exit-fault-mode`);
              } catch (error) {
                throw new Error(extractErrorMessage(error, "Couldn't clear the fault."), { cause: error });
              }
            }}
          >
            <HistoryChart profileId={activeProfile.id} registers={registers} />
          </ReadingPanel>
        )}
      </main>
    </div>
  );
}
