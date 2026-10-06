import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from '../lib/apiClient';
import type { InverterProfile } from '../auth/types';
import type { LatestReading } from '../inverter/types';
import { dayRange, toDay, type Day } from '../readings/days';
import { computeArray, utilization, type PanelType } from './pvArray';

/** 5-minute buckets over a day. */
const PEAK_POINTS = 288;

const kW = (watts: number) => `${(watts / 1000).toFixed(1)} kW`;

/** Highest 5-minute average PV power since local midnight; undefined until known. */
function useTodayPeakPv(profileId: number, today: Day): number | undefined {
  const [peak, setPeak] = useState<number>();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await axios.get<{ points: { values: Record<string, number> }[] }>(
          `/api/inverter/${profileId}/history`,
          {
            params: { from: dayRange(today).from, to: new Date().toISOString(), points: PEAK_POINTS, fields: 'PVPower' },
          },
        );
        const values = data.points.map((p) => p.values.PVPower).filter((v) => typeof v === 'number');
        if (!cancelled) setPeak(values.length ? Math.max(...values) : undefined);
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

/** The solar array at a glance: how much of its rating is in use now and at today's peak. */
export default function PvArrayTile({ profileId, profile, panelTypes, reading, today = toDay(new Date()) }: Props) {
  const peakW = useTodayPeakPv(profileId, today);
  const panel = panelTypes.find((t) => t.id === profile.pvPanelTypeId);
  const { pvPanelsInSeries: inSeries, pvStrings: strings } = profile;

  const card = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900';

  if (!panel || !inSeries || !strings) {
    return (
      <section aria-label="PV array" className={card}>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">PV array</p>
        <Link
          to={`/dashboard/${profileId}/solar`}
          className="mt-2 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Set up your solar array
        </Link>
      </section>
    );
  }

  const array = computeArray(panel, { inSeries, strings });
  const pvW = reading?.payload.PVPower;
  const pvV = reading?.payload.PVVoltage;
  const share = utilization(pvW, array.powerW);
  const peakShare = utilization(peakW, array.powerW);

  return (
    <section aria-label="PV array" className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">PV array</p>
        <Link to={`/dashboard/${profileId}/solar`} className="text-xs text-gray-500 hover:underline dark:text-gray-400">
          {array.panels} × {panel.name} ({inSeries}S{strings}P)
        </Link>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">{share ?? '--'}%</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, share ?? 0)}%` }} />
      </div>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        {pvW === undefined ? '--' : kW(pvW)} of {kW(array.powerW)}
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        PV voltage {pvV === undefined ? '--' : `${pvV} V`} · Vmp {array.vmpV} V
      </p>
      {peakW !== undefined && peakShare !== undefined && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Today's peak {peakShare}% ({kW(peakW)})
        </p>
      )}
    </section>
  );
}
