import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import axios from '../lib/apiClient';
import { loadSources, selfSufficiency, type EnergyTotals } from '../energy/energyMix';
import { dayRange, shiftDay, toDay, type Day } from '../readings/days';
import { Segmented } from '../ui';

type Span = 7 | 30;
const SPANS: { value: '7' | '30'; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
];

interface DayTotals {
  day: Day;
  totals: EnergyTotals | null;
}

const kWh = (v: number) => `${v.toFixed(1)} kWh`;
const label = (day: Day) => format(parseISO(day), 'd MMM');

/** The days of a period ending on `last`, oldest first. */
const daysEnding = (last: Day, span: Span): Day[] => Array.from({ length: span }, (_, i) => shiftDay(last, i - span + 1));

/** Energy per day over the last 7 or 30 days: totals, and where each day's load came from. */
export default function DailyEnergy({ profileId, today = toDay(new Date()) }: { profileId: number; today?: Day }) {
  const [span, setSpan] = useState<Span>(7);
  const [last, setLast] = useState<Day>(today);
  const [data, setData] = useState<DayTotals[] | null>(null);
  const [selected, setSelected] = useState<Day>(today);
  const days = daysEnding(last, span);
  const first = days[0];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setData(null);
      const range = daysEnding(last, span);
      const results = await Promise.all(
        range.map(async (day) => {
          try {
            const { data: totals } = await axios.get<EnergyTotals>(`/api/inverter/${profileId}/energy`, { params: dayRange(day) });
            return { day, totals };
          } catch {
            return { day, totals: null };
          }
        }),
      );
      if (!cancelled) setData(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, last, span]);

  const known = (data ?? []).flatMap((d) => (d.totals ? [d.totals] : []));
  const sum = (key: keyof EnergyTotals) => known.reduce((acc, t) => acc + t[key], 0);
  const period = { pvKWh: sum('pvKWh'), gridKWh: sum('gridKWh'), outputKWh: sum('outputKWh') };
  const ss = selfSufficiency(period);
  const maxLoad = Math.max(1, ...known.map((t) => t.outputKWh));
  const pick = data?.find((d) => d.day === selected)?.totals ?? null;
  const pickSources = pick ? loadSources(pick) : null;
  const periodLabel = `${format(parseISO(first), 'd MMM')} – ${format(parseISO(last), 'd MMM yyyy')}`;

  const tiles = [
    { name: 'Solar', colour: 'var(--pv)', value: data ? kWh(period.pvKWh) : '--' },
    { name: 'Grid', colour: 'var(--grid)', value: data ? kWh(period.gridKWh) : '--' },
    { name: 'Load', colour: 'var(--load)', value: data ? kWh(period.outputKWh) : '--' },
    { name: 'Self-sufficiency', colour: 'var(--good)', value: ss === undefined || !data ? '--' : `${ss}%` },
  ];
  const navButton = 'grid h-9 w-9 place-items-center rounded-lg border border-line-strong hover:bg-surface-2 disabled:opacity-40';

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="Period"
          size="sm"
          options={SPANS}
          value={String(span) as '7' | '30'}
          onChange={(v) => {
            setSpan(Number(v) as Span);
            setLast(today);
            setSelected(today);
          }}
        />
        <button type="button" aria-label="Previous period" className={navButton} onClick={() => setLast(shiftDay(first, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-semibold">{periodLabel}</span>
        <button
          type="button"
          aria-label="Next period"
          className={navButton}
          disabled={last >= today}
          onClick={() => {
            const next = shiftDay(last, span);
            setLast(next > today ? today : next);
          }}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-[13px] text-muted">Where the load’s energy came from, per day</p>

      <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.name} role="group" aria-label={t.name} className="rounded-[10px] bg-surface-2 p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: t.colour }} />
              {t.name}
            </p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums">{t.value}</p>
          </div>
        ))}
      </div>

      {!data && <div className="mt-4 h-56 animate-pulse rounded-lg bg-surface-2" />}
      {data && (
        <>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]">
            <b>{label(selected)}</b>
            {pickSources && pick ? (
              <>
                <Legend colour="var(--pv)" name="Solar direct" value={kWh(pickSources.solar)} />
                <Legend colour="var(--batt)" name="From battery" value={kWh(pickSources.battery)} />
                <Legend colour="var(--grid)" name="From grid" value={kWh(pickSources.grid)} />
                <Legend colour="var(--pv-fill)" name="Solar produced" value={kWh(pick.pvKWh)} />
              </>
            ) : (
              <span className="text-muted">No data for this day</span>
            )}
          </div>
          <div className="mt-3 flex h-56 items-end gap-[3px]">
            {data.map(({ day, totals }) => {
              const s = totals ? loadSources(totals) : null;
              const h = (v: number) => `${(v / maxLoad) * 100}%`;
              const isSelected = day === selected;
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${label(day)}: ${totals ? totals.outputKWh.toFixed(1) : '--'} kWh load`}
                  onClick={() => setSelected(day)}
                  className={'flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-[3px] ' + (isSelected ? '' : 'opacity-60 hover:opacity-90')}
                >
                  {s && (
                    <>
                      <span className="block w-full rounded-t-[3px] bg-grid" style={{ height: h(s.grid) }} />
                      <span className="block w-full bg-batt" style={{ height: h(s.battery) }} />
                      <span className="block w-full bg-pv" style={{ height: h(s.solar) }} />
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[11px] text-muted">
            <span>{label(first)}</span>
            {span === 30 && <span>{label(days[15])}</span>}
            <span>{label(last)}</span>
          </div>
        </>
      )}
    </section>
  );
}

function Legend({ colour, name, value }: { colour: string; name: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-[2px]" style={{ background: colour }} />
      <span className="text-muted">{name}</span>
      <b className="tabular-nums">{value}</b>
    </span>
  );
}
