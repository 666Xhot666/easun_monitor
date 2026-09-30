import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import axios from './lib/apiClient';
import {
  HISTORY_RANGES,
  getRange,
  rangeQuery,
  toChartRows,
  type ChartRow,
  type History,
  type HistoryRangeId,
} from './history/historyRange';

const SERIES = ['PVPower', 'BatteryVoltage'];

type FetchState = 'loading' | 'ok' | 'empty' | 'error';

export default function HistoryChart({ profileId }: { profileId: number }) {
  const [rangeId, setRangeId] = useState<HistoryRangeId>('24h');
  const [rows, setRows] = useState<ChartRow[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const range = getRange(rangeId);

  // Re-fetched when the inverter or the range changes. Averages over a
  // range barely move between live polls, so this doesn't poll.
  useEffect(() => {
    let cancelled = false;

    async function fetchHistory() {
      if (cancelled) return;
      setFetchState('loading');
      try {
        const { data } = await axios.get<History>(`/api/inverter/${profileId}/history`, {
          params: { ...rangeQuery(rangeId), fields: SERIES.join(',') },
        });
        if (cancelled) return;
        setRows(toChartRows(data, SERIES));
        setFetchState(data.points.length === 0 ? 'empty' : 'ok');
      } catch {
        if (cancelled) return;
        setFetchState('error');
      }
    }

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [profileId, rangeId]);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          History
        </h2>
        <div className="flex gap-1" role="group" aria-label="History range">
          {HISTORY_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === rangeId}
              onClick={() => setRangeId(r.id)}
              className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${
                r.id === rangeId
                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        {fetchState === 'loading' && (
          <p className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading history…</p>
        )}

        {fetchState === 'error' && (
          <p className="py-16 text-center text-sm text-red-600 dark:text-red-400">
            Couldn't load history. Pick the range again to retry.
          </p>
        )}

        {fetchState === 'empty' && (
          <p className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
            No history in this range yet.
          </p>
        )}

        {fetchState === 'ok' && (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="0" vertical={false} />
                <XAxis
                  dataKey="at"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(at: number) => format(at, range.axisFormat)}
                  stroke="var(--chart-axis)"
                  tick={{ fill: 'var(--chart-axis)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--chart-grid)' }}
                  minTickGap={24}
                />
                <YAxis
                  yAxisId="left"
                  stroke="var(--chart-axis)"
                  tick={{ fill: 'var(--chart-axis)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  label={{ value: 'PV Power (W)', angle: -90, position: 'insideLeft', fill: 'var(--chart-axis)', fontSize: 12 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="var(--chart-axis)"
                  tick={{ fill: 'var(--chart-axis)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  label={{ value: 'Battery Voltage (V)', angle: 90, position: 'insideRight', fill: 'var(--chart-axis)', fontSize: 12 }}
                />
                <Tooltip
                  labelFormatter={(at) => format(Number(at), 'MMM d yyyy, HH:mm')}
                  contentStyle={{
                    background: 'var(--chart-grid)',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="PVPower"
                  name="PV Power (W)"
                  stroke="var(--chart-series-pv-power)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="BatteryVoltage"
                  name="Battery Voltage (V)"
                  stroke="var(--chart-series-battery-voltage)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}
