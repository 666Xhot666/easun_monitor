import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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

const CHARTS: { field: string; title: string; color: string; scale?: number }[] = [
  { field: 'stateOfChargePct', title: 'State of charge (%)', color: '#16a34a' },
  { field: 'packVoltageV', title: 'Pack voltage (V)', color: '#2563eb' },
  { field: 'currentA', title: 'Current (A)', color: '#d97706' },
  { field: 'cellDeltaV', title: 'Cell spread (mV)', color: '#dc2626', scale: 1000 },
];
const FIELDS = CHARTS.map((c) => c.field);

type FetchState = 'loading' | 'ok' | 'empty' | 'error';

/** The BMS's stored readings over a range: state of charge, pack voltage, current, cell spread. */
export default function BmsHistoryCharts({ profileId, bmsId }: { profileId: number; bmsId: number }) {
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
          for (const c of CHARTS) {
            const v = row[c.field];
            if (c.scale && typeof v === 'number') out[c.field] = Math.round(v * c.scale * 10) / 10;
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

  return (
    <section aria-labelledby="bms-history-title" className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2
          id="bms-history-title"
          className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          History
        </h2>
        <div className="flex gap-1">
          {HISTORY_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === rangeId}
              onClick={() => setRangeId(r.id)}
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                r.id === rangeId
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {fetchState === 'error' && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Couldn't load the BMS history.
        </p>
      )}
      {fetchState === 'empty' && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No stored BMS readings in this range.</p>
      )}
      {fetchState === 'ok' && (
        <div className="grid gap-4 md:grid-cols-2">
          {CHARTS.map((c) => (
            <figure
              key={c.field}
              aria-label={c.title}
              className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
            >
              <figcaption className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{c.title}</figcaption>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="at"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(t: number) => format(t, range.axisFormat)}
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis tick={{ fontSize: 10 }} width={40} domain={['auto', 'auto']} />
                    <Tooltip labelFormatter={(t) => format(Number(t), 'PPpp')} />
                    <Line type="monotone" dataKey={c.field} stroke={c.color} dot={false} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
