import { Link, useParams } from 'react-router-dom';
import BmsHistoryCharts from '../bms/BmsHistoryCharts';
import BmsLivePanel from '../bms/BmsLivePanel';
import { useBmsDevices } from '../bms/useBmsDevices';
import { useBmsLatest } from '../bms/useBmsLatest';

/** The battery as its BMS reports it: live values, cells, status and history. */
export default function BatteryPage() {
  const { profileId: profileIdParam } = useParams<{ profileId: string }>();
  const profileId = Number(profileIdParam);
  const { devices } = useBmsDevices(profileId);
  // One BMS per inverter for now; the data model allows more.
  const device = devices?.[0] ?? null;
  const latest = useBmsLatest(profileId, device?.id ?? null);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-6xl">
          <Link to={`/dashboard/${profileId}`} className="text-xs text-gray-500 hover:underline dark:text-gray-400">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Battery{device ? ` · ${device.name}` : ''}
          </h1>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        {devices === null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : !device ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            No BMS set up yet.{' '}
            <Link to={`/dashboard/${profileId}/settings`} className="text-blue-600 hover:underline dark:text-blue-400">
              Add one in Settings
            </Link>
            .
          </p>
        ) : (
          <>
            <BmsLivePanel latest={latest} />
            <BmsHistoryCharts profileId={profileId} bmsId={device.id} />
          </>
        )}
      </main>
    </div>
  );
}
