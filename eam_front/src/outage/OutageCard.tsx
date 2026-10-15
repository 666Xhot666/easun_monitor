import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { ageText, useNow } from '../shell/age';
import { Button, CardTitle, Dot } from '../ui';
import type { ForecastState, ForecastWindow, OutageForecast } from './types';
import { useOutageForecast } from './useOutage';

const KYIV = 'Europe/Kyiv';
const time = new Intl.DateTimeFormat('en-GB', { timeZone: KYIV, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: KYIV, year: 'numeric', month: '2-digit', day: '2-digit' });

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

/** The message key for each state without windows. */
const NO_DATA: Partial<Record<ForecastState, string>> = {
  disabled: 'outage.card.disabled',
  pending: 'outage.card.pending',
  'not-found': 'outage.card.notFound',
  'no-groups': 'outage.card.noGroups',
};
/** Why the last check failed, by its outcome; known outcomes have a text. */
const FAILURES = ['CHALLENGE', 'REJECTED', 'SHAPE', 'SERVER', 'NETWORK'];

const groupName = (group: string) => group.replace(/^GPV/, '');
const sourceText = (w: ForecastWindow) =>
  w.source === 'repair' ? (w.description ?? t('outage.card.repair')) : t(w.source === 'weekly' ? 'outage.card.weekly' : 'outage.card.confirmed');

interface Props {
  profileId: number;
  /** Clock, injectable for tests. */
  now?: number;
}

/**
 * Today and tomorrow's scheduled outages for the inverter's DTEK address:
 * whether power is scheduled on now, what comes, how sure and how old.
 */
export default function OutageCard({ profileId, now: fixedNow }: Props) {
  const { t } = useTranslation();
  const { forecast, reload } = useOutageForecast(profileId);
  const tick = useNow(30_000);
  const now = fixedNow ?? tick;
  /** A check asked for: sent, or why not. */
  const [asked, setAsked] = useState<{ sent: true } | { error: string } | null>(null);

  // The reader asks every minute; look for its check a few times.
  useEffect(() => {
    if (!asked || !('sent' in asked)) return;
    const timers = [60_000, 120_000, 180_000].map((ms) => setTimeout(reload, ms));
    const done = setTimeout(() => setAsked(null), 180_000);
    return () => [...timers, done].forEach(clearTimeout);
  }, [asked, reload]);

  if (!forecast || forecast.state === 'none') return null;

  const checkNow = async () => {
    try {
      await axios.post(`/api/inverter/profiles/${profileId}/outage-source/refresh`);
      setAsked({ sent: true });
    } catch (e) {
      setAsked({ error: extractErrorMessage(e, t('outage.card.checkFailed')) });
    }
  };

  const groups = forecast.groups.map(groupName).join(', ');
  const today = dayOf.format(now);
  const isToday = (iso: string) => dayOf.format(new Date(iso)) === today;
  const day = (iso: string) => t(isToday(iso) ? 'outage.card.today' : 'outage.card.tomorrow');
  const until = (iso: string) =>
    isToday(iso) ? time.format(new Date(iso)) : t('outage.card.tomorrowSuffix', { time: time.format(new Date(iso)) });
  const noData = NO_DATA[forecast.state] && t(NO_DATA[forecast.state]!);
  const upcoming = forecast.windows.filter((w) => Date.parse(w.end) > now);

  return (
    <section aria-label={t('outage.card.title')} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <div className="flex items-start justify-between gap-2">
        <CardTitle hint={groups && t(forecast.groups.length > 1 ? 'outage.card.groups' : 'outage.card.group', { groups })}>
          {t('outage.card.title')}
        </CardTitle>
        {forecast.state !== 'disabled' && (
          <Button size="sm" variant="ghost" disabled={asked !== null && 'sent' in asked} onClick={() => void checkNow()}>
            {t('outage.card.checkNow')}
          </Button>
        )}
      </div>
      {asked && (
        <p className="text-xs text-muted">{'sent' in asked ? t('outage.card.checkRequested') : asked.error}</p>
      )}
      {noData ? (
        <p className="text-sm text-muted">{noData}</p>
      ) : (
        <>
          <Headline forecast={forecast} until={until} />
          {upcoming.length === 0 ? (
            forecast.lastOkAt && <p className="text-sm text-muted">{t('outage.card.noOutages')}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {upcoming.map((w) => (
                <li key={`${w.start}-${w.source}`} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="font-mono tabular-nums">
                    {day(w.start)} {time.format(new Date(w.start))}–{time.format(new Date(w.end))}
                  </span>
                  <span className={'text-right ' + (w.source === 'weekly' ? 'text-muted' : '')}>
                    {t(`outage.card.status.${w.status}`)} · {sourceText(w)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Freshness forecast={forecast} now={now} />
        </>
      )}
    </section>
  );
}

function Headline({ forecast, until }: { forecast: OutageForecast; until: (iso: string) => string }) {
  const { status, window } = forecast.now;
  if (!window) {
    const known = status === 'on';
    return (
      <p className="flex items-center gap-2 text-[17px]">
        <Dot tone={known ? 'good' : 'idle'} />
        {t(known ? 'outage.card.powerOn' : 'outage.card.notKnown')}
      </p>
    );
  }
  const text =
    status === 'off'
      ? t('outage.card.offUntil', { time: until(window.end) })
      : status === 'possible'
        ? t('outage.card.possibleUntil', { time: until(window.end) })
        : t('outage.card.unclearUntil', { time: until(window.end) });
  const label =
    window.source === 'repair'
      ? (window.description ?? t('outage.card.repairOnHouse'))
      : t(window.source === 'weekly' ? 'outage.card.weeklyNotConfirmed' : 'outage.card.confirmedSchedule');
  return (
    <div>
      <p className="flex items-center gap-2 text-[17px]">
        <Dot tone={status === 'off' && window.source !== 'weekly' ? 'crit' : 'warn'} />
        {text}
      </p>
      <p className="mt-0.5 pl-4 text-xs text-muted">{label}</p>
    </div>
  );
}

function Freshness({ forecast, now }: { forecast: OutageForecast; now: number }) {
  const { lastOkAt, lastCheck } = forecast;
  if (forecast.state === 'fresh' && lastOkAt) {
    return <p className="text-xs text-muted">{t('outage.card.checkedAgo', { age: ageText(now - Date.parse(lastOkAt)) })}</p>;
  }
  const failure = lastCheck && FAILURES.includes(lastCheck.outcome) ? t(`outage.card.failure.${lastCheck.outcome}`) : null;
  const since = lastOkAt ? t('outage.card.noCheckFor', { age: ageText(now - Date.parse(lastOkAt)) }) : t('outage.card.noCheckYet');
  return (
    <p role="alert" className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-xs text-warn-ink">
      {since}
      {failure ? `: ${failure}.` : '.'}
      {lastOkAt && ` ${t('outage.card.mayHaveChanged')}`}
    </p>
  );
}
