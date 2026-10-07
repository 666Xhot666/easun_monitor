import { Link } from 'react-router-dom';
import { BatteryMedium } from 'lucide-react';
import BmsHistoryCharts from '../bms/BmsHistoryCharts';
import BmsLivePanel from '../bms/BmsLivePanel';
import { useBmsDevices } from '../bms/useBmsDevices';
import { useBmsLatest } from '../bms/useBmsLatest';
import { useLiveData } from '../shell/LiveData';
import { EmptyState, PageHeader } from '../ui';

/** The battery as its BMS reports it: live values, cells, status and history. */
export default function BatteryPage() {
  const { profile, isAdmin } = useLiveData();
  const { devices } = useBmsDevices(profile.id);
  // One BMS per inverter for now; the data model allows more.
  const device = devices?.[0] ?? null;
  const latest = useBmsLatest(profile.id, device?.id ?? null);
  const settingsHref = `/dashboard/${profile.id}/settings/battery-monitor`;

  return (
    <>
      <PageHeader title="Battery" subtitle={device ? `${device.name} · as its BMS reports it` : 'The pack as its BMS reports it'} />
      {devices === null ? (
        <div className="h-64 animate-pulse rounded-xl border border-line bg-surface-2" aria-busy="true" />
      ) : !device ? (
        <EmptyState
          icon={<BatteryMedium className="h-7 w-7" />}
          title="No battery monitor yet"
          action={
            isAdmin && (
              <Link to={settingsHref} className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-page">
                Set up a battery monitor
              </Link>
            )
          }
        >
          With a BMS reader connected, this page shows the pack’s charge, every cell, temperatures and alarms.
          {!isAdmin && ' Ask a household admin to set one up.'}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <BmsLivePanel latest={latest} settingsHref={isAdmin ? settingsHref : undefined} />
          <BmsHistoryCharts profileId={profile.id} bmsId={device.id} />
        </div>
      )}
    </>
  );
}
