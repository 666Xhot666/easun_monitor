import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import axios from '../lib/apiClient';
import type { InverterProfile } from '../auth/types';
import type { LatestReading } from '../inverter/types';
import { dayRange, toDay, type Day } from '../readings/days';
import { computeArray, utilization, type PanelType } from './pvArray';

/** 5-minute buckets over a day. */
const PEAK_POINTS = 288;

const kW = (watts: number) => `${(watts / 1000).toFixed(1)} kW`;

/** Highest 5-minute average PV power since local midnight, and when; undefined until known. */
function useTodayPeakPv(profileId: number, today: Day): { watts: number; at: string } | undefined {
  const [peak, setPeak] = useState<{ watts: number; at: string }>();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await axios.get<{ points: { timestamp: string; values: Record<string, number> }[] }>(
          `/api/inverter/${profileId}/history`,
          {
            params: { from: dayRange(today).from, to: new Date().toISOString(), points: PEAK_POINTS, fields: 'PVPower' },
          },
        );
        let best: { watts: number; at: string } | undefined;
        for (const point of data.points) {
          const watts = point.values.PVPower;
          if (typeof watts === 'number' && (!best || watts > best.watts)) best = { watts, at: point.timestamp };
        }
        if (!cancelled) setPeak(best);
      } catch {
        // The tile works without its peak line.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, today]);
  return peak;
}

interface Props {
  profileId: number;
  profile: Pick<InverterProfile, 'pvPanelTypeId' | 'pvPanelsInSeries' | 'pvStrings'>;
  panelTypes: PanelType[];
  reading: LatestReading | null;
  today?: Day;
}

const card = 'flex h-full flex-col gap-2.5 rounded-xl border border-line bg-surface p-4 sm:p-[18px]';

/** The solar array at a glance: how much of its rating is in use now and at today's peak. */
export default function PvArrayTile({ profileId, profile, panelTypes, reading, today = toDay(new Date()) }: Props) {
  const peak = useTodayPeakPv(profileId, today);
  const panel = panelTypes.find((t) => t.id === profile.pvPanelTypeId);
  const { pvPanelsInSeries: inSeries, pvStrings: strings } = profile;

  if (!panel || !inSeries || !strings) {
    return (
      <section aria-label="Solar now" className={card}>
        <h2 className="text-[15px] font-semibold">Solar now</h2>
        <p className="text-sm leading-relaxed text-muted">Add your panels and string layout to see utilisation and get wiring warnings.</p>
        <Link
          to={`/dashboard/${profileId}/settings/solar`}
          className="mt-1 inline-flex h-10 w-fit items-center rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-surface-2"
        >
          Set up solar array
        </Link>
      </section>
    );
  }

  const array = computeArray(panel, { inSeries, strings });
  const pvW = reading?.payload.PVPower;
  const pvV = reading?.payload.PVVoltage;
  const share = utilization(pvW, array.powerW);
  const peakShare = utilization(peak?.watts, array.powerW);

  return (
    <section aria-label="Solar now" className={card}>
      <h2 className="text-[15px] font-semibold">Solar now</h2>
      <p className="flex items-baseline gap-1.5">
        <span className="text-[28px] font-semibold tabular-nums">{share ?? '--'}%</span>
        <span className="text-[13px] text-muted">utilisation</span>
      </p>
      <div className="h-2 overflow-hidden rounded bg-surface-2">
        <div className="h-full rounded bg-pv" style={{ width: `${Math.min(100, share ?? 0)}%` }} />
      </div>
      <p className="text-[13px] text-muted">
        {pvW === undefined ? '--' : kW(pvW)} of {kW(array.powerW)} array
      </p>
      <div className="mt-1 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[13px]">
        <div>
          <p className="text-xs text-muted">PV voltage</p>
          <p className="text-[15px] font-semibold tabular-nums">{pvV === undefined ? '--' : `${pvV} V`}</p>
          <p className="text-xs text-muted">Array Vmp {Math.round(array.vmpV)} V</p>
        </div>
        <div>
          <p className="text-xs text-muted">Today’s peak</p>
          <p className="text-[15px] font-semibold tabular-nums">{peak ? kW(peak.watts) : '--'}</p>
          {peak && peakShare !== undefined && (
            <p className="text-xs text-muted">
              {peakShare}% at {format(new Date(peak.at), 'HH:mm')}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
