import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  { value: 'power', label: 'history.tabs.power' },
  { value: 'energy', label: 'history.tabs.energy' },
  { value: 'readings', label: 'history.tabs.readings' },
];

/** Inverter and battery data over time: power, energy per day, and every stored reading. */
export default function HistoryPage() {
  const { t } = useTranslation();
  const { profile, registers } = useLiveData();
  const { devices } = useBmsDevices(profile.id);
  const [tab, setTab] = useState<Tab>('power');
  const [exporting, setExporting] = useState(false);
  const logged = registers?.filter((d) => (d.group === 'telemetry' || d.group === 'status') && d.verified !== false);

  return (
    <>
      <PageHeader title={t('history.title')} subtitle={t('history.subtitle')} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented ariaLabel={t('history.view')} options={TABS.map((o) => ({ ...o, label: t(o.label) }))} value={tab} onChange={setTab} />
        <Button className="ml-auto" onClick={() => setExporting(true)}>
          <Download className="h-4 w-4" />
          {t('history.export')}
        </Button>
      </div>
      {tab === 'power' && <PowerHistory profileId={profile.id} />}
      {tab === 'energy' && <DailyEnergy profileId={profile.id} />}
      {tab === 'readings' &&
        (logged ? <ReadingsBrowser profileId={profile.id} registers={logged} bmsId={devices?.[0]?.id ?? null} /> : <p className="text-sm text-muted">{t('common.loading')}</p>)}
      <Dialog
        open={exporting}
        title={t('history.exportTitle')}
        onClose={() => setExporting(false)}
        width={560}
        actions={<Button onClick={() => setExporting(false)}>{t('history.close')}</Button>}
      >
        <ReadingsExport profileId={profile.id} bmsId={devices?.[0]?.id ?? null} />
      </Dialog>
    </>
  );
}
