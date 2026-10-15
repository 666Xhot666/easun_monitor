import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { dateLocale, num, unit, withUnit } from '../i18n/format';
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
const RANGES: Range[] = ['24h', '7d'];

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
              labelFormatter={(at) => format(Number(at), 'PPp', { locale: dateLocale() })}
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
  const { t } = useTranslation();
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
    <section aria-label={t('server.history.title')} className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{t('server.history.title')}</h2>
        <Segmented
          ariaLabel={t('server.history.range')}
          size="sm"
          options={RANGES.map((value) => ({ value, label: t(`ranges.${value}`) }))}
          value={range}
          onChange={setRange}
        />
      </div>
      {failed && (
        <p role="alert" className="py-10 text-center text-sm text-crit-ink">
          {t('server.history.failed')}
        </p>
      )}
      {!failed && !points && <div className="mt-4 h-72 animate-pulse rounded-lg bg-surface-2" />}
      {!failed && points?.length === 0 && <p className="py-10 text-center text-sm text-muted">{t('server.history.empty')}</p>}
      {!failed && rows.length > 0 && (
        <div className="mt-4 space-y-5">
          <Chart
            title={t('server.history.cpuMemory')}
            summary={cpu === null ? '' : t('server.history.peak', { value: `${num(cpu, Number.isInteger(cpu) ? 0 : 1)} %` })}
            rows={rows}
            unit=" %"
            domain={[0, 100]}
            lines={[
              { key: 'cpuPercent', label: t('server.history.cpuLine'), colour: 'var(--load)' },
              { key: 'memoryPercent', label: t('server.history.memoryLine'), colour: 'var(--soc)' },
            ]}
            show={(_k, v) => `${num(v, Number.isInteger(v) ? 0 : 1)} %`}
          />
          <Chart
            title={t('server.history.tempFan')}
            summary={temp === null ? '' : t('server.history.peak', { value: `${num(temp, Number.isInteger(temp) ? 0 : 1)} °C` })}
            rows={rows}
            unit=" °C"
            rightUnit={` ${unit('rpm')}`}
            lines={[
              { key: 'temperatureMax', label: t('server.history.hottest'), colour: 'var(--batt)' },
              { key: 'fanRpm', label: t('server.history.fanLine'), colour: 'var(--muted)', right: true },
            ]}
            show={(k, v) => (k === 'fanRpm' ? withUnit(Math.round(v), 'rpm') : `${num(v, Number.isInteger(v) ? 0 : 1)} °C`)}
          />
          <Chart
            title={t('server.history.network')}
            summary={rx === null && tx === null ? '' : t('server.history.peakNet', { rx: rate(rx), tx: rate(tx) })}
            rows={rows}
            unit=""
            lines={[
              { key: 'rxBytesPerSecond', label: t('server.history.received'), colour: 'var(--grid)' },
              { key: 'txBytesPerSecond', label: t('server.history.sent'), colour: 'var(--pv)' },
            ]}
            show={(_k, v) => rate(v)}
          />
        </div>
      )}
    </section>
  );
}
