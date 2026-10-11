import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import axios from '../lib/apiClient';
import { Segmented } from '../ui';
import { rate } from './format';

/** GET /api/server/history point. */
interface Point {
  at: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  temperatureMax: number | null;
  fanRpm: number | null;
  rxBytesPerSecond: number | null;
  txBytesPerSecond: number | null;
}

type Range = '24h' | '7d';
const RANGES: { value: Range; label: string }[] = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 d' },
];

const axisTick = { fill: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' };
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 };

/** The largest value of `key`, or null when there is none. */
function peak(points: Point[], key: keyof Omit<Point, 'at'>): number | null {
  return points.reduce<number | null>((max, p) => (p[key] !== null && (max === null || p[key]! > max) ? p[key] : max), null);
}

interface ChartLine {
  key: keyof Omit<Point, 'at'>;
  label: string;
  colour: string;
  /** The right-hand axis. */
  right?: boolean;
}

function Chart({ title, summary, rows, lines, unit, rightUnit, domain, show }: {
  title: string;
  summary: string;
  rows: Array<Point & { t: number }>;
  lines: ChartLine[];
  unit: string;
  rightUnit?: string;
  domain?: [number, number];
  show: (key: ChartLine['key'], v: number) => string;
}) {
  return (
    <div>
      <p className="flex justify-between text-xs text-muted">
        <span>{title}</span>
        <span>{summary}</span>
      </p>
      <div className="mt-1 h-36" role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
            <YAxis yAxisId="left" width={44} tick={axisTick} tickLine={false} axisLine={false} unit={unit} domain={domain ?? ['auto', 'auto']} tickCount={3} />
            {rightUnit && <YAxis yAxisId="right" orientation="right" width={52} tick={axisTick} tickLine={false} axisLine={false} unit={rightUnit} tickCount={3} />}
            <Tooltip
              labelFormatter={(t) => format(Number(t), 'PPp')}
              formatter={(v, _name, item) => (typeof v === 'number' ? show(item.dataKey as ChartLine['key'], v) : '--')}
              contentStyle={tooltipStyle}
            />
            {lines.map((l) => (
              <Line
                key={l.key}
                yAxisId={l.right ? 'right' : 'left'}
                dataKey={l.key}
                name={l.label}
                type="monotone"
                stroke={l.colour}
                strokeWidth={1.6}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** CPU, memory, temperature, fan and network over the last day or week. */
export default function ServerHistory() {
  const [range, setRange] = useState<Range>('24h');
  const [points, setPoints] = useState<Point[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<{ bucketSeconds: number; points: Point[] }>('/api/server/history', { params: { range } })
      .then(({ data }) => {
        if (!cancelled) {
          setPoints(data.points);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const rows = (points ?? []).map((p) => ({ ...p, t: Date.parse(p.at) }));
  const cpu = peak(rows, 'cpuPercent');
  const temp = peak(rows, 'temperatureMax');
  const rx = peak(rows, 'rxBytesPerSecond');
  const tx = peak(rows, 'txBytesPerSecond');

  return (
    <section aria-label="History" className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">History</h2>
        <Segmented ariaLabel="Range" size="sm" options={RANGES} value={range} onChange={setRange} />
      </div>
      {failed && (
        <p role="alert" className="py-10 text-center text-sm text-crit-ink">
          Couldn’t load the history.
        </p>
      )}
      {!failed && !points && <div className="mt-4 h-72 animate-pulse rounded-lg bg-surface-2" />}
      {!failed && points?.length === 0 && <p className="py-10 text-center text-sm text-muted">No history yet.</p>}
      {!failed && rows.length > 0 && (
        <div className="mt-4 space-y-5">
          <Chart
            title="CPU and memory"
            summary={cpu === null ? '' : `Peak ${cpu} %`}
            rows={rows}
            unit=" %"
            domain={[0, 100]}
            lines={[
              { key: 'cpuPercent', label: 'CPU', colour: 'var(--load)' },
              { key: 'memoryPercent', label: 'Memory', colour: 'var(--soc)' },
            ]}
            show={(_k, v) => `${v} %`}
          />
          <Chart
            title="Temperature and fan"
            summary={temp === null ? '' : `Peak ${temp} °C`}
            rows={rows}
            unit=" °C"
            rightUnit=" rpm"
            lines={[
              { key: 'temperatureMax', label: 'Hottest sensor', colour: 'var(--batt)' },
              { key: 'fanRpm', label: 'Fan', colour: 'var(--muted)', right: true },
            ]}
            show={(k, v) => (k === 'fanRpm' ? `${Math.round(v).toLocaleString('en-US')} rpm` : `${v} °C`)}
          />
          <Chart
            title="Network"
            summary={rx === null && tx === null ? '' : `Peak ↓ ${rate(rx)} ↑ ${rate(tx)}`}
            rows={rows}
            unit=""
            lines={[
              { key: 'rxBytesPerSecond', label: 'Received', colour: 'var(--grid)' },
              { key: 'txBytesPerSecond', label: 'Sent', colour: 'var(--pv)' },
            ]}
            show={(_k, v) => rate(v)}
          />
        </div>
      )}
    </section>
  );
}
