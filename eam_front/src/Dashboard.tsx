import { PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { clock } from './i18n/format';
import EnergyScene from './energy/EnergyScene';
import EnergyTotals from './energy/EnergyTotals';
import Last24Hours from './energy/Last24Hours';
import { sceneValues } from './energy/overviewModel';
import { describeDeviceStatus } from './inverter/useDeviceStatus';
import OutageCard from './outage/OutageCard';
import PvArrayTile from './solar/PvArrayTile';
import SunForecastTile from './solar/SunForecastTile';
import { computeArray } from './solar/pvArray';
import { usePanelTypes } from './solar/usePanelTypes';
import { useBmsDevices } from './bms/useBmsDevices';
import { useBmsLatest } from './bms/useBmsLatest';
import { ageText, useNow } from './shell/age';
import { useLiveData } from './shell/LiveData';
import type { SystemState } from './shell/systemState';
import { Dot, EmptyState, PageHeader } from './ui';

const SENTENCE_DOT: Record<SystemState, 'good' | 'warn' | 'crit' | 'idle'> = {
  loading: 'idle',
  waiting: 'idle',
  live: 'good',
  fault: 'crit',
  stale: 'warn',
  offline: 'warn',
};

/** Overview: what the system is doing now and how today is going. */
export default function Dashboard() {
  const { profile, reading, registers, deviceStatus, systemState, pollMs } = useLiveData();
  const { panelTypes } = usePanelTypes();
  const { devices: bmsDevices } = useBmsDevices(profile.id);
  const bms = bmsDevices?.[0] ?? null;
  const bmsLatest = useBmsLatest(profile.id, bms?.useForEnergyFlow ? bms.id : null);
  const panel = panelTypes?.find((t) => t.id === profile.pvPanelTypeId);
  const pvRatedW =
    panel && profile.pvPanelsInSeries && profile.pvStrings
      ? computeArray(panel, { inSeries: profile.pvPanelsInSeries, strings: profile.pvStrings }).powerW
      : undefined;
  const now = useNow();
  const base = `/dashboard/${profile.id}`;
  const { t } = useTranslation();
  const header = <PageHeader title={t('overview.title')} subtitle={t('overview.subtitle')} />;

  if (systemState === 'loading' || !registers) {
    return (
      <>
        {header}
        <div className="grid gap-4 lg:grid-cols-3" aria-busy="true" aria-label={t('common.loading')}>
          <div className="h-[340px] animate-pulse rounded-xl border border-line bg-surface-2 lg:col-span-2" />
          <div className="h-[340px] animate-pulse rounded-xl border border-line bg-surface-2" />
        </div>
      </>
    );
  }

  if (systemState === 'waiting' || !reading) {
    const problem = deviceStatus ? describeDeviceStatus(deviceStatus) : null;
    return (
      <>
        {header}
        <EmptyState icon={<PlugZap className="h-7 w-7" />} title={t('overview.waitingTitle')}>
          {t('overview.waitingBody', { name: profile.name, address: profile.ipAddress, seconds: pollMs / 1000 })}
          {problem && <span className="mt-2 block text-warn-ink">{problem}</span>}
        </EmptyState>
      </>
    );
  }

  const live = bmsLatest?.status === 'live' ? bmsLatest.reading : undefined;
  const values = sceneValues(reading.payload, { pvRatedW, bms: live });
  const modeRegister = registers.find((d) => d.name === 'OperationMode');
  const mode = modeRegister?.options?.[reading.payload.OperationMode] ?? '--';
  const age = ageText(now - Date.parse(reading.timestamp));
  const readAt = clock(reading.timestamp);
  const sentence =
    systemState === 'stale'
      ? t('overview.lastKnown', { sentence: values.sentence })
      : systemState === 'offline'
        ? t('overview.lastKnownAt', { time: readAt, sentence: values.sentence })
        : systemState === 'fault'
          ? t('overview.faultMode', { sentence: values.sentence })
          : values.sentence;
  const dimmed = systemState === 'stale' || systemState === 'offline';

  return (
    <>
      {header}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface px-5 py-4">
        <Dot tone={SENTENCE_DOT[systemState]} />
        <p className={'text-[17px] ' + (dimmed ? 'text-muted' : '')}>{sentence}</p>
      </div>
      <div className={'grid gap-4 lg:grid-cols-3 ' + (dimmed ? 'opacity-80' : '')}>
        <section className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-4 sm:p-[18px] lg:col-span-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            {t('overview.energyFlow')}
            <span className={'text-xs font-medium ' + (systemState === 'fault' ? 'text-crit-ink' : 'text-muted')}>
              {profile.name} · {mode}
            </span>
          </h2>
          <EnergyScene
            watts={values.watts}
            pv={values.pv}
            grid={values.grid}
            load={values.load}
            battery={values.battery}
            mode={mode}
            systemState={systemState}
            staleNote={systemState === 'offline' ? t('overview.offlineNote', { time: readAt }) : t('overview.lastReadingAgo', { age })}
          />
        </section>
        <EnergyTotals profileId={profile.id} />
        {panelTypes && <PvArrayTile profileId={profile.id} profile={profile} panelTypes={panelTypes} reading={reading} />}
        <div className="lg:col-span-2">
          <Last24Hours profileId={profile.id} historyHref={`${base}/history`} />
        </div>
        <OutageCard profileId={profile.id} />
        <SunForecastTile profileId={profile.id} />
      </div>
    </>
  );
}
