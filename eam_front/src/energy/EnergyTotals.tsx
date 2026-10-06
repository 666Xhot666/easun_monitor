import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import { dayRange, shiftDay, toDay, type Day } from '../readings/days';

/** GET /api/inverter/:profileId/energy response. */
interface Totals {
  pvKWh: number;
  gridKWh: number;
  outputKWh: number;
  /** How much of the range had readings close enough together to integrate. */
  coveredSeconds: number;
}

const ROWS: { label: string; key: keyof Totals }[] = [
  { label: 'PV', key: 'pvKWh' },
  { label: 'Grid', key: 'gridKWh' },
  { label: 'Load', key: 'outputKWh' },
];

/** Below this share of a day with readings, the totals say how much they cover. */
const FULL_COVERAGE = 0.95;
const REFRESH_MS = 60_000;

const formatKWh = (kWh: number | undefined) =>
  kWh === undefined ? '--' : `${kWh.toFixed(kWh < 10 ? 2 : 1)} kWh`;

function useDayTotals(profileId: number, day: Day, refreshMs: number | null): Totals | null {
  const [totals, setTotals] = useState<Totals | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await axios.get<Totals>(`/api/inverter/${profileId}/energy`, { params: dayRange(day) });
        if (!cancelled) setTotals(data);
      } catch {
        if (!cancelled) setTotals(null);
      }
    };
    void load();
    const timer = refreshMs ? setInterval(() => void load(), refreshMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [profileId, day, refreshMs]);
  return totals;
}

/** "Data for 62% of today so far", or null when the day is (nearly) fully covered. */
function coverageNote(totals: Totals | null, day: Day, nowMs: number, name: string, soFar: boolean): string | null {
  if (!totals) return null;
  const { from, to } = dayRange(day);
  const elapsedSeconds = (Math.min(nowMs, Date.parse(to)) - Date.parse(from)) / 1000;
  if (elapsedSeconds <= 0) return null;
  const share = totals.coveredSeconds / elapsedSeconds;
  if (share >= FULL_COVERAGE) return null;
  return `Data for ${Math.round(share * 100)}% of ${name}${soFar ? ' so far' : ''}`;
}

interface Props {
  profileId: number;
  today?: Day;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/** Today's and yesterday's PV, grid-import and load energy, integrated by the server from the readings. */
export default function EnergyTotals({ profileId, today = toDay(new Date()), now = Date.now }: Props) {
  const yesterday = shiftDay(today, -1);
  const todayTotals = useDayTotals(profileId, today, REFRESH_MS);
  const yesterdayTotals = useDayTotals(profileId, yesterday, null);
  const notes = [
    coverageNote(todayTotals, today, now(), 'today', true),
    coverageNote(yesterdayTotals, yesterday, now(), 'yesterday', false),
  ].filter((note): note is string => note !== null);

  const cell = 'px-2 py-1.5 text-right tabular-nums';
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <table aria-label="Energy" className="w-full text-sm">
        <caption className="mb-2 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Energy</caption>
        <thead>
          <tr className="text-xs text-gray-500 dark:text-gray-400">
            <th scope="col" className="px-2 py-1 text-left font-normal" />
            <th scope="col" className="px-2 py-1 text-right font-normal">Today</th>
            <th scope="col" className="px-2 py-1 text-right font-normal">Yesterday</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {ROWS.map(({ label, key }) => (
            <tr key={key}>
              <th scope="row" className="px-2 py-1.5 text-left font-medium text-gray-700 dark:text-gray-200">
                {label}
              </th>
              <td className={`${cell} font-semibold text-gray-900 dark:text-gray-50`}>{formatKWh(todayTotals?.[key])}</td>
              <td className={`${cell} text-gray-600 dark:text-gray-300`}>{formatKWh(yesterdayTotals?.[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {notes.map((note) => (
        <p key={note} className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {note}
        </p>
      ))}
    </section>
  );
}
