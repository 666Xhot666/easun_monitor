import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { unit, withUnit } from '../i18n/format';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import axios from '../lib/apiClient';
import { rangeQuery, type History } from '../history/historyRange';
import { toPowerRows, type PowerRow } from './powerRows';
import { LAST_24H_REFRESH_MS } from './constants';

const FIELDS = ['PVPower', 'OutputActivePower', 'AverageMainsPower', 'BatteryCurrentSigned', 'BatteryVoltage', 'BatterySoc'];

const LEGEND = [
  { name: 'last24.solar', swatch: 'h-2.5 w-2.5 rounded-[2px] bg-pv' },
  { name: 'last24.load', swatch: 'h-0.5 w-2.5 bg-load' },
  { name: 'last24.battery', swatch: 'h-0.5 w-2.5 bg-batt', title: 'last24.batteryTitle' },
  { name: 'last24.soc', swatch: 'h-2.5 w-2.5 rounded-[2px] bg-soc opacity-60' },
  { name: 'last24.grid', swatch: 'h-2.5 w-2.5 rounded-[2px] bg-grid' },
];

const axisTick = { fill: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' };

/** Power by source over the last 24 hours, with the battery's state of charge under it. */
export default function Last24Hours({ profileId, historyHref }: { profileId: number; historyHref: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PowerRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await axios.get<History>(`/api/inverter/${profileId}/history`, {
          params: { ...rangeQuery('24h'), fields: FIELDS.join(',') },
        });
        if (!cancelled) {
          setRows(toPowerRows(data));
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), LAST_24H_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [profileId]);

  return (
    <section className="flex h-full flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-[15px] font-semibold">{t('last24.title')}</h2>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {LEGEND.map((l) => (
            <span key={l.name} className="flex items-center gap-1.5" title={l.title && t(l.title)}>
              <span className={l.swatch} />
              {t(l.name)}
            </span>
          ))}
        </div>
        <Link
          to={historyHref}
          className="ml-auto inline-flex h-8 items-center rounded-lg border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2"
        >
          {t('last24.openHistory')}
        </Link>
      </div>
      {failed && !rows && <p className="py-12 text-center text-sm text-muted">{t('last24.failed')}</p>}
      {!failed && !rows && <div className="h-[220px] animate-pulse rounded-lg bg-surface-2" />}
      {rows && rows.length === 0 && <p className="py-12 text-center text-sm text-muted">{t('last24.empty')}</p>}
      {rows && rows.length > 0 && (
        <div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="at" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
                <YAxis width={44} tick={axisTick} tickLine={false} axisLine={false} unit={` ${unit('kW')}`} tickCount={4} />
                <ReferenceLine y={0} stroke="var(--border2)" />
                <Tooltip
                  labelFormatter={(at) => format(Number(at), 'HH:mm')}
                  formatter={(value) => (typeof value === 'number' ? withUnit(value, 'kW', 2) : '--')}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                />
                <Area dataKey="pv" name={t('last24.solar')} type="monotone" stroke="var(--pv)" fill="var(--pv-fill)" strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
                <Area dataKey="grid" name={t('last24.grid')} type="monotone" stroke="var(--grid)" fill="var(--grid-fill)" strokeWidth={1.5} isAnimationActive={false} />
                <Line dataKey="battery" name={t('last24.battery')} type="monotone" stroke="var(--batt)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line dataKey="load" name={t('last24.load')} type="monotone" stroke="var(--load)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="w-[44px] flex-none text-right font-mono text-[11px] text-muted">{t('last24.soc')}</span>
            <div className="h-7 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
                  <XAxis dataKey="at" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
                  <YAxis domain={[0, 100]} hide />
                  <Area dataKey="soc" type="monotone" stroke="var(--soc)" fill="var(--soc)" fillOpacity={0.35} strokeWidth={1} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="mt-1 flex justify-between pl-[52px] font-mono text-[11px] text-muted">
            {[0, 0.25, 0.5, 0.75].map((f) => (
              <span key={f}>{format(rows[0].at + f * (rows[rows.length - 1].at - rows[0].at), 'HH:mm')}</span>
            ))}
            <span>{t('last24.now')}</span>
          </div>
        </div>
      )}
    </section>
  );
}
