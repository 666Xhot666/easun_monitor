import { format, isSameDay, subDays } from 'date-fns';

/** GET /api/inverter/:profileId/alerts item. */
export interface AlertEvent {
  id: number;
  kind: 'fault' | 'warning' | 'grid' | 'battery' | 'connection';
  text: string;
  source: string | null;
  at: string;
}

const DOT: Record<AlertEvent['kind'], string> = {
  fault: 'bg-crit',
  warning: 'bg-warn',
  battery: 'bg-warn',
  grid: 'bg-grid',
  connection: 'bg-idle',
};
const LABEL: Record<AlertEvent['kind'], string> = {
  fault: 'Fault',
  warning: 'Warning',
  battery: 'Battery',
  grid: 'Grid',
  connection: 'Connection',
};

function dayHeading(day: Date, today: Date): string {
  if (isSameDay(day, today)) return 'Today';
  if (isSameDay(day, subDays(today, 1))) return 'Yesterday';
  return format(day, 'EEE d MMM');
}

/** Alerts grouped by day, newest first: time, kind, what happened and, for BMS alerts, which BMS. */
export default function AlertTimeline({ events, today = new Date() }: { events: AlertEvent[]; today?: Date }) {
  const groups: { day: Date; items: AlertEvent[] }[] = [];
  for (const event of events) {
    const at = new Date(event.at);
    const last = groups[groups.length - 1];
    if (last && isSameDay(last.day, at)) last.items.push(event);
    else groups.push({ day: at, items: [event] });
  }

  return (
    <div>
      {groups.map(({ day, items }) => (
        <section key={day.toISOString()}>
          <h3 className="mt-5 mb-2 text-sm font-semibold first:mt-0">{dayHeading(day, today)}</h3>
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {items.map((e) => (
              <li key={e.id} className="flex gap-4 border-t border-line px-4 py-3.5 first:border-t-0">
                <time dateTime={e.at} className="w-12 flex-none pt-0.5 font-mono text-[13px] text-muted">
                  {format(new Date(e.at), 'HH:mm')}
                </time>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${DOT[e.kind]}`} />
                    <span className="text-[15px] font-semibold">{e.text}</span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{LABEL[e.kind]}</span>
                  </p>
                  {e.source && <p className="mt-0.5 text-[13px] text-muted">{e.source}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
