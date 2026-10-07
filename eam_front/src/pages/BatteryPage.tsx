import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../ui';
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
    <>
      <PageHeader title={`Battery${device ? ` · ${device.name}` : ''}`} subtitle="The pack as its BMS reports it" />
      {devices === null ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : !device ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          No BMS set up yet.{' '}
          <Link to={`/dashboard/${profileId}/settings/battery-monitor`} className="text-blue-600 hover:underline dark:text-blue-400">
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
    </>
  );
}
