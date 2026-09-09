import { useEffect, useState } from 'react';
import axios from 'axios';
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

interface InverterLog {
  id: number;
  timestamp: string;
  payload: Record<string, number>;
}

// Flattened, chart-ready row. `time` is a display label (HH:mm); `rawTimestamp`
// is kept for the tooltip, which shows the full time rather than just HH:mm —
// two readings taken minutes apart can otherwise round to the same label.
interface HistoryPoint {
  time: string;
  rawTimestamp: string;
  PVPower: number | null;
  BatteryVoltage: number | null;
}

// Nested payload -> flat rows Recharts can consume. A missing/non-numeric
// field becomes null rather than 0, so recharts draws a gap in the line
// instead of a misleading drop to zero.
function toHistoryPoints(logs: InverterLog[]): HistoryPoint[] {
  return logs.map((log) => {
    const date = new Date(log.timestamp);
    const pvPower = log.payload?.PVPower;
    const batteryVoltage = log.payload?.BatteryVoltage;
    return {
      time: Number.isNaN(date.getTime()) ? log.timestamp : format(date, 'HH:mm'),
      rawTimestamp: log.timestamp,
      PVPower: typeof pvPower === 'number' ? pvPower : null,
      BatteryVoltage: typeof batteryVoltage === 'number' ? batteryVoltage : null,
    };
  });
}

function formatTooltipTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : format(date, 'MMM d, HH:mm:ss');
}

type FetchState = 'loading' | 'ok' | 'empty' | 'error';

export default function HistoryChart({ profileId }: { profileId: number }) {
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');

  // Re-fetched whenever the active inverter changes (not just on mount) —
  // switching profiles via the dashboard's switcher needs a fresh history
  // for the newly-selected device, not the previous one's stale points.
  // The API already returns the last 100 readings, and re-fetching on the
  // same 5s cadence as the live poll would just redraw an all-but-identical
  // chart every tick for no visible benefit, so this still only runs once
  // per profileId change, not on an interval.
  useEffect(() => {
    let cancelled = false;

    async function fetchHistory() {
      // Reset to a loading view for the newly-selected profile — placed
      // here (inside the async function, not as a direct effect-body
      // statement) so it doesn't trip react-hooks' set-state-in-effect
      // rule.
      if (cancelled) return;
      setFetchState('loading');
      try {
        const { data } = await axios.get<InverterLog[]>(`/api/inverter/${profileId}/history`);
        if (cancelled) return;
        setPoints(toHistoryPoints(data));
        setFetchState(data.length === 0 ? 'empty' : 'ok');
      } catch {
        if (cancelled) return;
        setFetchState('error');
      }
    }

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        History
      </h2>
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        {fetchState === 'loading' && (
          <p className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading history…</p>
        )}

        {fetchState === 'error' && (
          <p className="py-16 text-center text-sm text-red-600 dark:text-red-400">
            Couldn't load history — retry by refreshing the page.
          </p>
        )}

        {fetchState === 'empty' && (
          <p className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
            No history yet — check back once a few readings have been logged.
          </p>
        )}

        {fetchState === 'ok' && (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="0" vertical={false} />
                <XAxis
                  dataKey="time"
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
                  labelFormatter={(_label, item) => {
                    const raw = item?.[0]?.payload?.rawTimestamp as string | undefined;
                    return raw ? formatTooltipTimestamp(raw) : _label;
                  }}
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
                  connectNulls
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
                  connectNulls
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
