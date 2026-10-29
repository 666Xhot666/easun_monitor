import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { num, withUnit } from '../i18n/format';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { toDay, type Day } from '../readings/days';
import { FORECAST_REFRESH_MS } from './constants';

interface ForecastDay {
  date: Day;
  expectedKWh: number | null;
  actualKWh: number | null;
  cloudCover: number | null;
}

interface SolarForecast {
  days: ForecastDay[];
  assumedMounting: boolean;
}

const card = 'flex h-full flex-col gap-2.5 rounded-xl border border-line bg-surface p-4 sm:p-[18px]';
const linkButton = 'mt-1 inline-flex h-10 w-fit items-center rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-surface-2';

/** Share of the weather's allowance the array made over the past days that have both. */
function pastShare(days: ForecastDay[], today: Day): number | null {
  let actual = 0;
  let expected = 0;
  for (const day of days) {
    if (day.date >= today || day.actualKWh === null || !day.expectedKWh) continue;
    actual += day.actualKWh;
    expected += day.expectedKWh;
  }
  return expected > 0 ? Math.round((actual / expected) * 100) : null;
}

/** How much sun the weather allows: tomorrow, today so far, and how the past week did against it. */
export default function SunForecastTile({ profileId, today = toDay(new Date()) }: { profileId: number; today?: Day }) {
  const { t } = useTranslation();
  const [forecast, setForecast] = useState<SolarForecast>();
  const [error, setError] = useState('');
  const settingsHref = `/dashboard/${profileId}/settings/solar`;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await axios.get<SolarForecast>(`/api/inverter/${profileId}/solar-forecast`);
        if (!cancelled) {
          setForecast(data);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(extractErrorMessage(e, t('sunForecast.unavailable')));
      }
    };
    void load();
    const timer = setInterval(() => void load(), FORECAST_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [profileId, t]);

  const title = <h2 className="text-[15px] font-semibold">{t('sunForecast.title')}</h2>;
  if (error && !forecast) {
    return (
      <section aria-label={t('sunForecast.title')} className={card}>
        {title}
        <p className="text-sm leading-relaxed text-muted">{error}</p>
        <Link to={settingsHref} className={linkButton}>
          {t('sunForecast.setup')}
        </Link>
      </section>
    );
  }

  const tomorrow = forecast?.days.find((d) => d.date > today);
  const now = forecast?.days.find((d) => d.date === today);
  const share = forecast ? pastShare(forecast.days, today) : null;
  const kWh = (value: number | null | undefined) => (value == null ? '--' : withUnit(value, 'kWh', 1));

  return (
    <section aria-label={t('sunForecast.title')} className={card}>
      {title}
      <p className="flex items-baseline gap-1.5">
        <span className="text-[28px] font-semibold tabular-nums">{kWh(tomorrow?.expectedKWh)}</span>
      </p>
      <p className="text-[13px] text-muted">
        {tomorrow?.cloudCover == null
          ? t('sunForecast.tomorrow')
          : t('sunForecast.tomorrowCloud', { cloud: tomorrow.cloudCover })}
      </p>
      <div className="mt-1 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[13px]">
        <div>
          <p className="text-xs text-muted">{t('sunForecast.today')}</p>
          <p className="text-[15px] font-semibold tabular-nums">
            {t('sunForecast.ofExpected', {
              actual: now?.actualKWh == null ? '--' : num(now.actualKWh, 1),
              expected: kWh(now?.expectedKWh),
            })}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">{t('sunForecast.pastWeek')}</p>
          <p className="text-[15px] font-semibold tabular-nums">{share === null ? '--' : `${share}%`}</p>
          <p className="text-xs text-muted">{t('sunForecast.ofAllowed')}</p>
        </div>
      </div>
      {forecast?.assumedMounting && (
        <p className="text-xs text-muted">
          {t('sunForecast.assumed')}{' '}
          <Link to={settingsHref} className="underline">
            {t('sunForecast.setMounting')}
          </Link>
        </p>
      )}
    </section>
  );
}
