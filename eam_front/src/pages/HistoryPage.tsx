import { useState } from 'react';
import { Download } from 'lucide-react';
import { useBmsDevices } from '../bms/useBmsDevices';
import DailyEnergy from '../history/DailyEnergy';
import PowerHistory from '../history/PowerHistory';
import ReadingsBrowser from '../readings/ReadingsBrowser';
import ReadingsExport from '../readings/ReadingsExport';
import { useLiveData } from '../shell/LiveData';
import { Button, PageHeader, Segmented } from '../ui';
import { Dialog } from '../ui/Dialog';

type Tab = 'power' | 'energy' | 'readings';
const TABS: { value: Tab; label: string }[] = [
  { value: 'power', label: 'Power' },
  { value: 'energy', label: 'Daily energy' },
  { value: 'readings', label: 'Readings' },
];

/** Inverter and battery data over time: power, energy per day, and every stored reading. */
export default function HistoryPage() {
  const { profile, registers } = useLiveData();
  const { devices } = useBmsDevices(profile.id);
  const [tab, setTab] = useState<Tab>('power');
  const [exporting, setExporting] = useState(false);
  const logged = registers?.filter((d) => (d.group === 'telemetry' || d.group === 'status') && d.verified !== false);

  return (
    <>
      <PageHeader title="History" subtitle="Inverter and battery data over time" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented ariaLabel="View" options={TABS} value={tab} onChange={setTab} />
        <Button className="ml-auto" onClick={() => setExporting(true)}>
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>
      {tab === 'power' && <PowerHistory profileId={profile.id} />}
      {tab === 'energy' && <DailyEnergy profileId={profile.id} />}
      {tab === 'readings' &&
        (logged ? <ReadingsBrowser profileId={profile.id} registers={logged} /> : <p className="text-sm text-muted">Loading…</p>)}
      <Dialog
        open={exporting}
        title="Export readings"
        onClose={() => setExporting(false)}
        width={560}
        actions={<Button onClick={() => setExporting(false)}>Close</Button>}
      >
        <ReadingsExport profileId={profile.id} bmsId={devices?.[0]?.id ?? null} />
      </Dialog>
    </>
  );
}
