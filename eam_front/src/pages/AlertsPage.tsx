import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../lib/apiClient';
import AlertTimeline, { type AlertEvent } from '../alerts/AlertTimeline';
import { markAlertsSeen } from '../alerts/seen';
import { useLiveData } from '../shell/LiveData';
import { Badge, Button, Dot, PageHeader, Segmented } from '../ui';

const PAGE = 50;
type Filter = 'all' | 'outages' | Exclude<AlertEvent['kind'], 'schedule' | 'outage' | 'schedule-unavailable'>;
const OUTAGE_KINDS: AlertEvent['kind'][] = ['schedule', 'outage', 'schedule-unavailable'];
const matches = (kind: AlertEvent['kind'], filter: Filter) =>
  filter === 'all' || (filter === 'outages' ? OUTAGE_KINDS.includes(kind) : kind === filter);
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'alerts.filters.all' },
  { value: 'fault', label: 'alerts.filters.fault' },
  { value: 'warning', label: 'alerts.filters.warning' },
  { value: 'grid', label: 'alerts.filters.grid' },
  { value: 'battery', label: 'alerts.filters.battery' },
  { value: 'connection', label: 'alerts.filters.connection' },
  { value: 'outages', label: 'alerts.filters.outages' },
];

/** What is wrong right now, and every recorded fault, warning, grid change and outage. */
export default function AlertsPage() {
  const { t } = useTranslation();
  const { profile, reading } = useLiveData();
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await axios.get<AlertEvent[]>(`/api/inverter/${profile.id}/alerts`, { params: { limit: PAGE } });
        if (cancelled) return;
        setEvents(data);
        setHasMore(data.length === PAGE);
        if (data[0]) markAlertsSeen(profile.id, data[0].id);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  async function loadMore() {
    const oldest = events?.[events.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const { data } = await axios.get<AlertEvent[]>(`/api/inverter/${profile.id}/alerts`, {
        params: { limit: PAGE, before: oldest.id },
      });
      setEvents((current) => [...(current ?? []), ...data]);
      setHasMore(data.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  }

  const active = [
    ...(reading?.alerts?.faults ?? []).map((text) => ({ text, kind: 'fault' as const })),
    ...(reading?.alerts?.warnings ?? []).map((text) => ({ text, kind: 'warning' as const })),
  ];
  const count = (f: Filter) => (events ?? []).filter((e) => matches(e.kind, f)).length;
  const shown = (events ?? []).filter((e) => matches(e.kind, filter));

  return (
    <>
      <PageHeader title={t('alerts.title')} subtitle={t('alerts.subtitle')} />
      {active.length > 0 && (
        <section aria-label={t('alerts.activeNow')} className="mb-5 rounded-xl border border-crit-line bg-crit-bg p-4 text-crit-ink">
          <p className="text-xs font-semibold tracking-wide uppercase">{t('alerts.activeNow')}</p>
          <ul className="mt-2 space-y-1.5">
            {active.map(({ text, kind }) => (
              <li key={`${kind}-${text}`} className="flex items-center gap-2.5">
                <Dot tone={kind === 'fault' ? 'crit' : 'warn'} />
                <span className="flex-1 text-[15px] font-semibold">{text}</span>
                <Badge tone={kind === 'fault' ? 'crit' : 'warn'}>{t(`alerts.${kind}`)}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mb-4 overflow-x-auto">
        <Segmented
          ariaLabel={t('alerts.show')}
          size="sm"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f.value, label: `${t(f.label)} · ${count(f.value)}` }))}
        />
      </div>
      {failed && (
        <p role="alert" className="text-sm text-crit-ink">
          {t('alerts.failed')}
        </p>
      )}
      {!failed && events === null && <div className="h-48 animate-pulse rounded-xl border border-line bg-surface-2" />}
      {events?.length === 0 && (
        <p className="rounded-xl border border-dashed border-line-strong p-7 text-center text-sm text-muted">{t('alerts.empty')}</p>
      )}
      {events && events.length > 0 && <AlertTimeline events={shown} />}
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button disabled={loadingMore} onClick={() => void loadMore()}>
            {t('alerts.loadOlder')}
          </Button>
        </div>
      )}
    </>
  );
}
