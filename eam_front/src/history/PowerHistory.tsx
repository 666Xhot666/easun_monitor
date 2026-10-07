import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import axios from '../lib/apiClient';
import { HISTORY_RANGES, getRange, rangeQuery, type History, type HistoryRangeId } from './historyRange';
import { Segmented } from '../ui';

type Key = 'pv' | 'load' | 'grid' | 'battery' | 'soc' | 'bv' | 'pvv' | 'mains';

interface Series {
  key: Key;
  label: string;
  colour: string;
  /** Power series share the kW chart; the rest get their own strip. */
  power: boolean;
  unit: string;
  /** Fixed strip range, for the non-power series. */
  domain?: [number, number];
  value: (v: Record<string, number>) => number | null;
}

const num = (v: Record<string, number>, name: string) => (typeof v[name] === 'number' ? v[name] : null);
const kw = (v: Record<string, number>, name: string) => {
  const w = num(v, name);
  return w === null ? null : w / 1000;
};

const SERIES: Series[] = [
  { key: 'pv', label: 'Solar', colour: 'var(--pv)', power: true, unit: 'kW', value: (v) => kw(v, 'PVPower') },
  { key: 'load', label: 'Load', colour: 'var(--load)', power: true, unit: 'kW', value: (v) => kw(v, 'OutputActivePower') },
  { key: 'grid', label: 'Grid', colour: 'var(--grid)', power: true, unit: 'kW', value: (v) => kw(v, 'AverageMainsPower') },
  {
    key: 'battery',
    label: 'Battery ±',
    colour: 'var(--batt)',
    power: true,
    unit: 'kW',
    value: (v) => {
      const a = num(v, 'BatteryCurrentSigned');
      const u = num(v, 'BatteryVoltage');
      return a === null || u === null ? null : (a * u) / 1000;
    },
  },
  { key: 'soc', label: 'Battery SoC', colour: 'var(--soc)', power: false, unit: '%', domain: [0, 100], value: (v) => num(v, 'BatterySoc') },
  { key: 'bv', label: 'Battery voltage', colour: 'var(--muted)', power: false, unit: 'V', value: (v) => num(v, 'BatteryVoltage') },
  { key: 'pvv', label: 'PV voltage', colour: 'var(--pv)', power: false, unit: 'V', value: (v) => num(v, 'PVVoltage') },
  { key: 'mains', label: 'Mains voltage', colour: 'var(--grid)', power: false, unit: 'V', value: (v) => num(v, 'MainsVoltage') },
];

const FIELDS = [
  'PVPower', 'OutputActivePower', 'AverageMainsPower', 'BatteryCurrentSigned', 'BatteryVoltage', 'BatterySoc', 'PVVoltage', 'MainsVoltage',
];
const DEFAULT_ON: Key[] = ['pv', 'load', 'grid', 'battery', 'soc'];

type Row = { at: number } & Partial<Record<Key, number | null>>;

const fmt = (s: Series, v: number | null | undefined) =>
  v === null || v === undefined ? '--' : s.unit === 'kW' ? `${s.key === 'battery' && v > 0 ? '+' : ''}${v.toFixed(2)} kW` : `${s.unit === '%' ? Math.round(v) : v.toFixed(1)}${s.unit === '%' ? '%' : ` ${s.unit}`}`;
const axisTick = { fill: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' };

/** Power by source and the battery, inverter and grid voltages over a chosen range. */
export default function PowerHistory({ profileId }: { profileId: number }) {
  const [rangeId, setRangeId] = useState<HistoryRangeId>('24h');
  const [on, setOn] = useState<Set<Key>>(new Set(DEFAULT_ON));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const range = getRange(rangeId);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setRows(null);
      setFailed(false);
      try {
        const { data } = await axios.get<History>(`/api/inverter/${profileId}/history`, {
          params: { ...rangeQuery(rangeId), fields: FIELDS.join(',') },
        });
        if (cancelled) return;
        setRows(
          data.points.map(({ timestamp, values }) => {
            const row: Row = { at: Date.parse(timestamp) };
            for (const s of SERIES) row[s.key] = s.value(values);
            return row;
          }),
        );
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, rangeId]);

  const toggle = (key: Key) =>
    setOn((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const shown = SERIES.filter((s) => on.has(s.key));
  const power = shown.filter((s) => s.power);
  const strips = shown.filter((s) => !s.power);
  const latest = (key: Key) => {
    if (!rows) return undefined;
    for (let i = rows.length - 1; i >= 0; i--) if (typeof rows[i][key] === 'number') return rows[i][key];
    return undefined;
  };
  const ticks = rows && rows.length > 1 ? [0, 0.25, 0.5, 0.75, 1].map((f) => rows[0].at + f * (rows[rows.length - 1].at - rows[0].at)) : [];

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="Range"
          size="sm"
          options={HISTORY_RANGES.map((r) => ({ value: r.id, label: r.label }))}
          value={rangeId}
          onChange={setRangeId}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Series">
        {SERIES.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={on.has(s.key)}
            onClick={() => toggle(s.key)}
            className={
              'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] transition ' +
              (on.has(s.key) ? 'border-line-strong bg-surface-2 text-ink' : 'border-line text-muted hover:text-ink')
            }
          >
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: s.colour, opacity: on.has(s.key) ? 1 : 0.4 }} />
            {s.label}
          </button>
        ))}
      </div>
      {on.has('battery') && <p className="mt-2 text-xs text-muted">Battery: + charging, − discharging. Grid and solar are always ≥ 0.</p>}
      {rows && shown.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <span className="font-mono text-xs text-muted">Latest</span>
          {shown.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: s.colour }} />
              <span className="text-muted">{s.label}</span>
              <b className="tabular-nums">{fmt(s, latest(s.key))}</b>
            </span>
          ))}
        </p>
      )}
      {failed && (
        <p role="alert" className="py-16 text-center text-sm text-crit-ink">
          Couldn’t load the history.
        </p>
      )}
      {!failed && !rows && <div className="mt-4 h-72 animate-pulse rounded-lg bg-surface-2" />}
      {rows && rows.length === 0 && <p className="py-16 text-center text-sm text-muted">No history in this range yet.</p>}
      {rows && rows.length > 0 && (
        <div className="mt-4">
          {power.length > 0 && (
            <div className="h-64" aria-label="Power" role="img">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <XAxis dataKey="at" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
                  <YAxis width={48} tick={axisTick} tickLine={false} axisLine={false} unit=" kW" tickCount={5} />
                  <ReferenceLine y={0} stroke="var(--border2)" />
                  <Tooltip
                    labelFormatter={(at) => format(Number(at), 'PPp')}
                    formatter={(v) => (typeof v === 'number' ? `${v.toFixed(2)} kW` : '--')}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  />
                  {power.map((s) =>
                    s.key === 'pv' || s.key === 'grid' ? (
                      <Area key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={s.colour} fill={s.key === 'pv' ? 'var(--pv-fill)' : 'var(--grid-fill)'} strokeWidth={1.5} isAnimationActive={false} />
                    ) : (
                      <Line key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={s.colour} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                    ),
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {strips.map((s) => (
            <div key={s.key} className="mt-3">
              <p className="pl-[52px] text-xs text-muted">
                {s.label}
                {s.domain ? ` · ${s.domain[0]}–${s.domain[1]} ${s.unit}` : ` (${s.unit})`}
              </p>
              <div className="h-16">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis dataKey="at" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
                    <YAxis width={48} tick={axisTick} tickLine={false} axisLine={false} domain={s.domain ?? ['auto', 'auto']} tickCount={2} />
                    <Tooltip
                      labelFormatter={(at) => format(Number(at), 'PPp')}
                      formatter={(v) => fmt(s, typeof v === 'number' ? v : null)}
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    />
                    <Line dataKey={s.key} name={s.label} type="monotone" stroke={s.colour} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
          <div className="mt-2 flex justify-between pl-[52px] font-mono text-[11px] text-muted">
            {ticks.map((t, i) => (
              <span key={t}>{i === ticks.length - 1 ? 'Now' : format(t, range.axisFormat)}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
