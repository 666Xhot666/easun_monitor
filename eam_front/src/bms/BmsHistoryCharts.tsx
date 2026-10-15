import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateLocale, withUnit } from '../i18n/format';
import { Area, AreaChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import axios from '../lib/apiClient';
import {
  HISTORY_RANGES,
  getRange,
  rangeQuery,
  toChartRows,
  type ChartRow,
  type History,
  type HistoryRangeId,
} from '../history/historyRange';
import { Segmented } from '../ui';

interface Series {
  field: string;
  title: string;
  /** Multiplies the stored value (V → mV). */
  scale?: number;
  colour: string;
  format: (v: number) => string;
  /** A dashed line at zero: current changes sign. */
  zero?: boolean;
}

const SERIES: Series[] = [
  { field: 'stateOfChargePct', title: 'battery.series.stateOfChargePct', colour: 'var(--soc)', format: (v) => `${Math.round(v)}%` },
  { field: 'packVoltageV', title: 'battery.series.packVoltageV', colour: 'var(--batt)', format: (v) => withUnit(v, 'V', 2) },
  { field: 'currentA', title: 'battery.series.currentA', colour: 'var(--batt)', format: (v) => withUnit(v, 'A', 1), zero: true },
  { field: 'cellDeltaV', title: 'battery.series.cellDeltaV', scale: 1000, colour: 'var(--batt)', format: (v) => withUnit(Math.round(v), 'mV') },
];
const FIELDS = SERIES.map((s) => s.field);

type FetchState = 'loading' | 'ok' | 'empty' | 'error';

/** The BMS's stored readings over a range, one row per measure with its latest value. */
export default function BmsHistoryCharts({ profileId, bmsId }: { profileId: number; bmsId: number }) {
  const { t } = useTranslation();
  const [rangeId, setRangeId] = useState<HistoryRangeId>('24h');
  const [rows, setRows] = useState<ChartRow[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const range = getRange(rangeId);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setFetchState('loading');
      try {
        const { data } = await axios.get<History>(`/api/inverter/profiles/${profileId}/bms/${bmsId}/history`, {
          params: { ...rangeQuery(rangeId), fields: FIELDS.join(',') },
        });
        if (cancelled) return;
        const scaled = toChartRows(data, FIELDS).map((row) => {
          const out: ChartRow = { ...row };
          for (const s of SERIES) {
            const v = row[s.field];
            if (s.scale && typeof v === 'number') out[s.field] = Math.round(v * s.scale * 10) / 10;
          }
          return out;
        });
        setRows(scaled);
        setFetchState(scaled.length ? 'ok' : 'empty');
      } catch {
        if (!cancelled) setFetchState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, bmsId, rangeId]);

  const latest = (field: string) => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = rows[i][field];
      if (typeof v === 'number') return v;
    }
    return undefined;
  };

  return (
    <section aria-labelledby="bms-history-title" className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 id="bms-history-title" className="text-[15px] font-semibold">
          {t('battery.history')}
        </h2>
        <Segmented
          ariaLabel={t('ranges.label')}
          size="sm"
          options={HISTORY_RANGES.map((r) => ({ value: r.id, label: t(`ranges.${r.id}`) }))}
          value={rangeId}
          onChange={setRangeId}
        />
        <span className="ml-auto font-mono text-xs text-muted">{t('battery.latest')}</span>
      </div>
      {fetchState === 'loading' && <div className="h-64 animate-pulse rounded-lg bg-surface-2" />}
      {fetchState === 'error' && (
        <p role="alert" className="py-10 text-center text-sm text-crit-ink">
          {t('battery.loadFailed')}
        </p>
      )}
      {fetchState === 'empty' && <p className="py-10 text-center text-sm text-muted">{t('battery.noStored')}</p>}
      {fetchState === 'ok' && (
        <div>
          {SERIES.map((s) => {
            const value = latest(s.field);
            return (
              <figure key={s.field} aria-label={t(s.title)} className="m-0 flex items-center gap-4 border-t border-line py-2.5">
                <figcaption className="w-32 flex-none sm:w-40">
                  <span className="block text-xs text-muted">{t(s.title)}</span>
                  <span className="text-[15px] font-semibold tabular-nums">{value === undefined ? '--' : s.format(value)}</span>
                </figcaption>
                <div className="h-12 min-w-0 flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    {s.field === 'stateOfChargePct' ? (
                      <AreaChart data={rows} margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
                        <XAxis dataKey="at" type="number" domain={['dataMin', 'dataMax']} hide />
                        <YAxis domain={[0, 100]} hide />
                        <Tooltip labelFormatter={(at) => format(Number(at), 'PPp', { locale: dateLocale() })} formatter={(v) => (typeof v === 'number' ? s.format(v) : '--')} />
                        <Area dataKey={s.field} name={t(s.title)} stroke={s.colour} fill={s.colour} fillOpacity={0.2} strokeWidth={1.5} isAnimationActive={false} connectNulls />
                      </AreaChart>
                    ) : (
                      <LineChart data={rows} margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
                        <XAxis dataKey="at" type="number" domain={['dataMin', 'dataMax']} hide />
                        <YAxis domain={['auto', 'auto']} hide />
                        {s.zero && <ReferenceLine y={0} stroke="var(--border2)" strokeDasharray="3 3" />}
                        <Tooltip labelFormatter={(at) => format(Number(at), 'PPp', { locale: dateLocale() })} formatter={(v) => (typeof v === 'number' ? s.format(v) : '--')} />
                        <Line dataKey={s.field} name={t(s.title)} stroke={s.colour} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </figure>
            );
          })}
          <div className="flex justify-between border-t border-line pt-2 pl-36 font-mono text-[11px] text-muted sm:pl-44">
            <span>{format(rows[0].at, range.axisFormat)}</span>
            <span>{t('battery.now')}</span>
          </div>
        </div>
      )}
    </section>
  );
}
