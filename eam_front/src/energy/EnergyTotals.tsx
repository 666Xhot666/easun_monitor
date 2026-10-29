import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { num, unit } from '../i18n/format';
import { dayRange, shiftDay, toDay, type Day } from '../readings/days';
import { loadSources, selfSufficiency, type EnergyTotals as Totals } from './energyMix';
import { FULL_COVERAGE, TOTALS_REFRESH_MS } from './constants';
import { api } from '../lib/api';

/** Decimals for an energy figure: 2 below 10 kWh, else 1. */
const decimals = (kWh: number) => (kWh < 10 ? 2 : 1);

/** Share of the load each source covered, in whole percent. */
function loadMix(t: Totals): { solar: number; battery: number; grid: number } | null {
  if (t.outputKWh <= 0) return null;
  const kWh = loadSources(t);
  const pct = (v: number) => Math.round((v / t.outputKWh) * 100);
  return { solar: pct(kWh.solar), battery: pct(kWh.battery), grid: pct(kWh.grid) };
}

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
      : i18n.t('today.delta', { arrow: today >= yesterday ? '↑' : '↓', change: num(Math.abs(today - yesterday), d), yesterday: num(yesterday, d) });
  return { label, colour, value: num(today, d), unit: unit('kWh'), delta };
}

function useDayTotals(profileId: number, day: Day, refreshMs: number | null): Totals | null {
  const [totals, setTotals] = useState<Totals | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.energy(profileId, dayRange(day));
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
function coverageNote(totals: Totals | null, day: Day, nowMs: number, which: 'today' | 'yesterday'): string | null {
  if (!totals) return null;
  const { from, to } = dayRange(day);
  const elapsedSeconds = (Math.min(nowMs, Date.parse(to)) - Date.parse(from)) / 1000;
  if (elapsedSeconds <= 0) return null;
  const share = totals.coveredSeconds / elapsedSeconds;
  if (share >= FULL_COVERAGE) return null;
  return i18n.t(which === 'today' ? 'today.coverageToday' : 'today.coverageYesterday', { share: Math.round(share * 100) });
}

interface Props {
  profileId: number;
  today?: Day;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/** Today's solar, grid and load energy against yesterday, the self-sufficiency and where the load's energy came from. */
export default function EnergyTotals({ profileId, today = toDay(new Date()), now = Date.now }: Props) {
  const { t } = useTranslation();
  const yesterday = shiftDay(today, -1);
  const todayTotals = useDayTotals(profileId, today, TOTALS_REFRESH_MS);
  const yesterdayTotals = useDayTotals(profileId, yesterday, null);
  const notes = [
    coverageNote(todayTotals, today, now(), 'today'),
    coverageNote(yesterdayTotals, yesterday, now(), 'yesterday'),
  ].filter((note): note is string => note !== null);

  const ss = todayTotals ? selfSufficiency(todayTotals) : undefined;
  const ssYesterday = yesterdayTotals ? selfSufficiency(yesterdayTotals) : undefined;
  const tiles: TileValue[] = [
    energyTile(t('today.solar'), 'var(--pv)', todayTotals?.pvKWh, yesterdayTotals?.pvKWh),
    energyTile(t('today.grid'), 'var(--grid)', todayTotals?.gridKWh, yesterdayTotals?.gridKWh),
    energyTile(t('today.load'), 'var(--load)', todayTotals?.outputKWh, yesterdayTotals?.outputKWh),
    {
      label: t('today.selfSufficiency'),
      colour: 'var(--good)',
      value: ss === undefined ? '--' : String(ss),
      unit: ss === undefined ? '' : '%',
      delta:
        ss === undefined || ssYesterday === undefined
          ? undefined
          : t('today.deltaPoints', { arrow: ss >= ssYesterday ? '↑' : '↓', change: Math.abs(ss - ssYesterday), yesterday: ssYesterday }),
    },
  ];
  const mix = todayTotals ? loadMix(todayTotals) : null;
  const parts = mix
    ? [
        { name: t('today.solar'), share: mix.solar, colour: 'var(--pv)' },
        { name: t('today.battery'), share: mix.battery, colour: 'var(--batt)' },
        { name: t('today.grid'), share: mix.grid, colour: 'var(--grid)' },
      ]
    : [];

  return (
    <section className="flex h-full flex-col gap-3.5 rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
        {t('today.title')} <span className="text-xs font-normal text-muted">{t('today.subtitle')}</span>
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
          <p className="text-xs text-muted">{t('today.loadSources')}</p>
          <div
            role="img"
            aria-label={t('today.loadSourcesAria', { parts: parts.map((p) => `${p.name.toLowerCase()} ${p.share}%`).join(', ') })}
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
