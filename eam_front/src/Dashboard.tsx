import HistoryChart from './HistoryChart';
import { describeDeviceStatus } from './inverter/useDeviceStatus';
import ReadingPanel from './inverter/ReadingPanel';
import EnergyFlowPanel from './energy/EnergyFlowPanel';
import EnergyTotals from './energy/EnergyTotals';
import PvArrayTile from './solar/PvArrayTile';
import { computeArray } from './solar/pvArray';
import { usePanelTypes } from './solar/usePanelTypes';
import { useBmsDevices } from './bms/useBmsDevices';
import { useBmsLatest } from './bms/useBmsLatest';
import { useLiveData } from './shell/LiveData';
import { PageHeader } from './ui';

export default function Dashboard() {
  const { profile, reading, readingStatus, registers, deviceStatus, pollMs } = useLiveData();
  const { panelTypes } = usePanelTypes();
  const { devices: bmsDevices } = useBmsDevices(profile.id);
  const bms = bmsDevices?.[0] ?? null;
  const bmsLatest = useBmsLatest(profile.id, bms?.useForEnergyFlow ? bms.id : null);
  const panel = panelTypes?.find((t) => t.id === profile.pvPanelTypeId);
  const pvRatedW =
    panel && profile.pvPanelsInSeries && profile.pvStrings
      ? computeArray(panel, { inSeries: profile.pvPanelsInSeries, strings: profile.pvStrings }).powerW
      : undefined;

  if (readingStatus === 'loading' || !registers) {
    return <p className="py-16 text-center text-muted">Loading inverter data…</p>;
  }

  if (readingStatus === 'no-data') {
    const problem = deviceStatus ? describeDeviceStatus(deviceStatus) : null;
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-medium">No readings yet</p>
        <p className="mt-1 text-sm text-muted">
          Waiting for the first poll from {profile.name} — checking again every {pollMs / 1000}s.
        </p>
        {problem && <p className="mt-2 text-sm text-warn-ink">{problem}</p>}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Overview" subtitle="What the system is doing now and how today is going" />
      <div className="mb-8 grid items-center gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EnergyFlowPanel reading={reading} pollMs={pollMs} pvRatedW={pvRatedW} bms={bmsLatest} />
        </div>
        <div className="space-y-6">
          {panelTypes && <PvArrayTile profileId={profile.id} profile={profile} panelTypes={panelTypes} reading={reading} />}
          <EnergyTotals profileId={profile.id} />
        </div>
      </div>
      {reading && (
        <ReadingPanel registers={registers} reading={reading}>
          <HistoryChart profileId={profile.id} registers={registers} />
        </ReadingPanel>
      )}
    </>
  );
}
