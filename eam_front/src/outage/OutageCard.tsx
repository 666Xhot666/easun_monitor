import { ageText, useNow } from '../shell/age';
import { CardTitle, Dot } from '../ui';
import type { ForecastState, ForecastWindow, OutageForecast } from './types';
import { useOutageForecast } from './useOutage';

const KYIV = 'Europe/Kyiv';
const time = new Intl.DateTimeFormat('en-GB', { timeZone: KYIV, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: KYIV, year: 'numeric', month: '2-digit', day: '2-digit' });

const STATUS: Record<ForecastWindow['status'], string> = { off: 'Off', possible: 'Possible', unknown: 'Unclear' };
const NO_DATA: Partial<Record<ForecastState, string>> = {
  disabled: 'Switched off in Settings.',
  pending: 'The reader looks the house up on its next check.',
  'not-found': 'The house is not on the DTEK site. Check the address in Settings.',
  'no-groups': 'The DTEK site lists no outage group for this house.',
};
/** Why the last check failed, by its outcome. */
const FAILURE: Record<string, string> = {
  CHALLENGE: 'the site blocked the reader',
  REJECTED: 'the site blocked the reader',
  SHAPE: "the site's page has changed",
  SERVER: 'the site was down',
  NETWORK: 'the site could not be reached',
};

const groupName = (group: string) => group.replace(/^GPV/, '');
const sourceText = (w: ForecastWindow) =>
  w.source === 'repair' ? (w.description ?? 'repair') : w.source === 'weekly' ? 'weekly pattern' : 'confirmed';

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
  const forecast = useOutageForecast(profileId);
  const tick = useNow(30_000);
  const now = fixedNow ?? tick;
  if (!forecast || forecast.state === 'none') return null;

  const groups = forecast.groups.map(groupName).join(', ');
  const today = dayOf.format(now);
  const day = (iso: string) => (dayOf.format(new Date(iso)) === today ? 'Today' : 'Tomorrow');
  const until = (iso: string) => `${time.format(new Date(iso))}${day(iso) === 'Today' ? '' : ' tomorrow'}`;
  const noData = NO_DATA[forecast.state];
  const upcoming = forecast.windows.filter((w) => Date.parse(w.end) > now);

  return (
    <section aria-label="Outage schedule" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <CardTitle hint={groups && `${forecast.groups.length > 1 ? 'Groups' : 'Group'} ${groups}`}>Outage schedule</CardTitle>
      {noData ? (
        <p className="text-sm text-muted">{noData}</p>
      ) : (
        <>
          <Headline forecast={forecast} until={until} />
          {upcoming.length === 0 ? (
            forecast.lastOkAt && <p className="text-sm text-muted">No outages scheduled for today or tomorrow.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {upcoming.map((w) => (
                <li key={`${w.start}-${w.source}`} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="font-mono tabular-nums">
                    {day(w.start)} {time.format(new Date(w.start))}–{time.format(new Date(w.end))}
                  </span>
                  <span className={'text-right ' + (w.source === 'weekly' ? 'text-muted' : '')}>
                    {STATUS[w.status]} · {sourceText(w)}
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
        {known ? 'Power on by the schedule' : 'Schedule not known yet'}
      </p>
    );
  }
  const text =
    status === 'off'
      ? `Power off until ${until(window.end)}`
      : status === 'possible'
        ? `Possible outage until ${until(window.end)}`
        : `Unclear until ${until(window.end)}`;
  const label =
    window.source === 'repair'
      ? (window.description ?? 'Repair on the house')
      : window.source === 'weekly'
        ? 'Weekly pattern, not confirmed'
        : 'Confirmed schedule';
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
    return <p className="text-xs text-muted">Checked {ageText(now - Date.parse(lastOkAt))} ago</p>;
  }
  const failure = lastCheck && FAILURE[lastCheck.outcome];
  const since = lastOkAt ? `No successful check for ${ageText(now - Date.parse(lastOkAt))}` : 'No successful check yet';
  return (
    <p role="alert" className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-xs text-warn-ink">
      {since}
      {failure ? `: ${failure}.` : '.'}
      {lastOkAt && ' The schedule may have changed.'}
    </p>
  );
}
