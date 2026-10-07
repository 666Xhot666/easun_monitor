import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import { dayRange, shiftDay, toDay, type Day } from '../readings/days';

/** GET /api/inverter/:profileId/energy response. */
interface Totals {
  pvKWh: number;
  gridKWh: number;
  outputKWh: number;
  /** Energy into and out of the battery, at its terminals. */
  batteryChargeKWh: number;
  batteryDischargeKWh: number;
  /** How much of the range had readings close enough together to integrate. */
  coveredSeconds: number;
}

/** Below this share of a day with readings, the totals say how much they cover. */
const FULL_COVERAGE = 0.95;
const REFRESH_MS = 60_000;

/** Decimals for an energy figure: 2 below 10 kWh, else 1. */
const decimals = (kWh: number) => (kWh < 10 ? 2 : 1);

/** Share of the load each source covered, in whole percent. */
function loadMix(t: Totals): { solar: number; battery: number; grid: number } | null {
  if (t.outputKWh <= 0) return null;
  const grid = Math.min(t.gridKWh, t.outputKWh);
  const battery = Math.min(t.batteryDischargeKWh, t.outputKWh - grid);
  const pct = (kWh: number) => Math.round((kWh / t.outputKWh) * 100);
  return { solar: pct(t.outputKWh - grid - battery), battery: pct(battery), grid: pct(grid) };
}

/** Share of the load not taken from the grid, in whole percent. */
const selfSufficiency = (t: Totals) => (t.outputKWh > 0 ? Math.round((1 - Math.min(t.gridKWh, t.outputKWh) / t.outputKWh) * 100) : undefined);

interface TileValue {
  label: string;
  colour: string;
  value: string;
  unit: string;
  /** "↑ 2.1 vs 12.1" */
  delta?: string;
}

function energyTile(label: string, colour: string, today: number | undefined, yesterday: number | undefined): TileValue {
  if (today === undefined) return { label, colour, value: '--', unit: '' };
  const d = decimals(today);
  const delta =
    yesterday === undefined
      ? undefined
      : `${today >= yesterday ? '↑' : '↓'} ${Math.abs(today - yesterday).toFixed(d)} vs ${yesterday.toFixed(d)}`;
  return { label, colour, value: today.toFixed(d), unit: 'kWh', delta };
}

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

/** Today's solar, grid and load energy against yesterday, the self-sufficiency and where the load's energy came from. */
export default function EnergyTotals({ profileId, today = toDay(new Date()), now = Date.now }: Props) {
  const yesterday = shiftDay(today, -1);
  const todayTotals = useDayTotals(profileId, today, REFRESH_MS);
  const yesterdayTotals = useDayTotals(profileId, yesterday, null);
  const notes = [
    coverageNote(todayTotals, today, now(), 'today', true),
    coverageNote(yesterdayTotals, yesterday, now(), 'yesterday', false),
  ].filter((note): note is string => note !== null);

  const ss = todayTotals ? selfSufficiency(todayTotals) : undefined;
  const ssYesterday = yesterdayTotals ? selfSufficiency(yesterdayTotals) : undefined;
  const tiles: TileValue[] = [
    energyTile('Solar', 'var(--pv)', todayTotals?.pvKWh, yesterdayTotals?.pvKWh),
    energyTile('Grid', 'var(--grid)', todayTotals?.gridKWh, yesterdayTotals?.gridKWh),
    energyTile('Load', 'var(--load)', todayTotals?.outputKWh, yesterdayTotals?.outputKWh),
    {
      label: 'Self-sufficiency',
      colour: 'var(--good)',
      value: ss === undefined ? '--' : String(ss),
      unit: ss === undefined ? '' : '%',
      delta:
        ss === undefined || ssYesterday === undefined
          ? undefined
          : `${ss >= ssYesterday ? '↑' : '↓'} ${Math.abs(ss - ssYesterday)} pts vs ${ssYesterday}%`,
    },
  ];
  const mix = todayTotals ? loadMix(todayTotals) : null;
  const parts = mix
    ? [
        { name: 'Solar', share: mix.solar, colour: 'var(--pv)' },
        { name: 'Battery', share: mix.battery, colour: 'var(--batt)' },
        { name: 'Grid', share: mix.grid, colour: 'var(--grid)' },
      ]
    : [];

  return (
    <section className="flex h-full flex-col gap-3.5 rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
        Today <span className="text-xs font-normal text-muted">so far, vs yesterday</span>
      </h2>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <div key={t.label} role="group" aria-label={t.label} className="flex flex-col gap-1 rounded-[10px] bg-surface-2 p-3">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: t.colour }} />
              {t.label}
            </span>
            <span className="text-[22px] leading-tight font-semibold tabular-nums">
              {t.value}
              {t.unit && <span className="ml-1 text-xs font-normal text-muted">{t.unit}</span>}
            </span>
            {t.delta && <span className="text-xs text-muted tabular-nums">{t.delta}</span>}
          </div>
        ))}
      </div>
      {mix && (
        <div className="mt-auto flex flex-col gap-2">
          <p className="text-xs text-muted">Where today’s load came from</p>
          <div
            role="img"
            aria-label={`Where today’s load came from: ${parts.map((p) => `${p.name.toLowerCase()} ${p.share}%`).join(', ')}`}
            className="flex h-2 gap-0.5 overflow-hidden rounded"
          >
            {parts.map((p) => p.share > 0 && <span key={p.name} style={{ width: `${p.share}%`, background: p.colour }} />)}
          </div>
          <p className="flex flex-wrap gap-3 text-xs" aria-hidden="true">
            {parts.map((p) => (
              <span key={p.name} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: p.colour }} />
                {p.name} <span className="text-muted">{p.share}%</span>
              </span>
            ))}
          </p>
        </div>
      )}
      {notes.map((note) => (
        <p key={note} className="text-xs text-warn-ink">
          {note}
        </p>
      ))}
    </section>
  );
}
