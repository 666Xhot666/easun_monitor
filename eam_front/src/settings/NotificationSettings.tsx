import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { Switch } from '../ui/Switch';

export type NotificationKind = 'fault' | 'warning' | 'grid' | 'battery' | 'connection' | 'schedule' | 'outage' | 'schedule-unavailable' | 'summary';
interface Channels {
  inApp: boolean;
  telegram: boolean;
}
/** GET/PUT /api/notifications/settings. */
export interface NotificationSettingsValue {
  channels: Record<NotificationKind, Channels>;
  quietHours: boolean;
  /** How long before an outage starts the "Outage in" notice comes. */
  outageLeadMinutes: number;
  /** The notice also before possible outages, not only confirmed ones. */
  possibleOutages: boolean;
}

const LEAD = { min: 1, max: 120 };

const ROWS: { kind: NotificationKind; label: string; detail: string }[] = [
  { kind: 'fault', label: 'Faults', detail: 'Inverter faults and fault mode, as they happen' },
  { kind: 'warning', label: 'Warnings', detail: 'Inverter warnings and BMS alarms' },
  { kind: 'grid', label: 'Grid lost and restored', detail: 'With how long the outage lasted' },
  { kind: 'battery', label: 'Battery low', detail: 'When the state of charge drops to the low level' },
  { kind: 'connection', label: 'Logger or BMS reader offline', detail: 'When there are no readings for 5 minutes' },
  { kind: 'schedule', label: 'Outage schedule updated', detail: 'A new or changed outage schedule for your address, old → new times' },
  { kind: 'outage', label: 'Outage soon', detail: 'Before a scheduled outage starts, with the battery level' },
  { kind: 'schedule-unavailable', label: 'Outage schedule unavailable', detail: 'When the DTEK site could not be checked for 12 hours' },
  { kind: 'summary', label: 'Daily summary', detail: 'In the evening: solar, grid, load, self-sufficiency' },
];

/** What reaches the signed-in user, per kind of alert, in the app and on Telegram. */
export default function NotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettingsValue | null>(null);
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState('');
  const [lead, setLead] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [s, link] = await Promise.all([
          axios.get<NotificationSettingsValue>('/api/notifications/settings'),
          axios.get<{ linked: boolean }>('/api/telegram/link'),
        ]);
        if (cancelled) return;
        setSettings(s.data);
        setLead(String(s.data.outageLeadMinutes));
        setLinked(link.data.linked);
      } catch (e) {
        if (!cancelled) setError(extractErrorMessage(e, 'Couldn’t load the notification settings.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(change: Partial<NotificationSettingsValue> | { channels: Partial<Record<NotificationKind, Partial<Channels>>> }) {
    setError('');
    try {
      const { data } = await axios.put<NotificationSettingsValue>('/api/notifications/settings', change);
      setSettings(data);
    } catch (e) {
      setError(extractErrorMessage(e, 'Couldn’t save the change.'));
    }
  }

  const saveLead = () => {
    if (!settings) return;
    const minutes = Number(lead);
    if (!Number.isInteger(minutes) || minutes < LEAD.min || minutes > LEAD.max) {
      setError(`From ${LEAD.min} to ${LEAD.max} minutes.`);
      return;
    }
    if (minutes === settings.outageLeadMinutes) return;
    setSettings({ ...settings, outageLeadMinutes: minutes });
    void save({ outageLeadMinutes: minutes });
  };

  const set = (kind: NotificationKind, channel: keyof Channels, on: boolean) => {
    if (!settings) return;
    // Shown at once; the saved settings replace it when the server answers.
    setSettings({ ...settings, channels: { ...settings.channels, [kind]: { ...settings.channels[kind], [channel]: on } } });
    void save({ channels: { [kind]: { [channel]: on } } });
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="text-[15px] font-semibold">What to send, and where</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        In the app: the bell in the top bar. The Alerts page always keeps the full history.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}
      {!settings && !error && <div className="mt-4 h-48 animate-pulse rounded-lg bg-surface-2" />}
      {settings && (
        <>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" className="pb-2 text-left font-normal" />
                <th scope="col" className="w-16 pb-2 font-semibold">In app</th>
                <th scope="col" className="w-20 pb-2 font-semibold">Telegram</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(({ kind, label, detail }) => (
                <tr key={kind} className="border-t border-line">
                  <th scope="row" className="py-3 pr-3 text-left font-normal">
                    <span className="block text-[15px]">{label}</span>
                    <span className="block text-xs text-muted">{detail}</span>
                  </th>
                  <td className="text-center">
                    <span className="inline-flex">
                      <Switch label={`${label} in the app`} on={settings.channels[kind].inApp} onChange={(on) => set(kind, 'inApp', on)} />
                    </span>
                  </td>
                  <td className="text-center">
                    <span className="inline-flex">
                      <Switch
                        label={`${label} on Telegram`}
                        on={linked && settings.channels[kind].telegram}
                        disabled={!linked}
                        onChange={(on) => set(kind, 'telegram', on)}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!linked && <p className="mt-2 text-xs text-muted">Link Telegram above to use these.</p>}
          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <div className="flex-1">
              <p className="text-[15px]">Quiet hours</p>
              <p className="text-xs text-muted">23:00 to 07:00: only faults reach Telegram.</p>
            </div>
            <Switch
              label="Quiet hours"
              on={settings.quietHours}
              onChange={(quietHours) => {
                setSettings({ ...settings, quietHours });
                void save({ quietHours });
              }}
            />
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <div className="flex-1">
              <label htmlFor="outage-lead" className="block text-[15px]">
                Minutes before an outage
              </label>
              <p id="outage-lead-hint" className="text-xs text-muted">
                When the &quot;Outage soon&quot; notice comes.
              </p>
            </div>
            <input
              id="outage-lead"
              aria-describedby="outage-lead-hint"
              type="number"
              inputMode="numeric"
              min={LEAD.min}
              max={LEAD.max}
              value={lead}
              onChange={(e) => setLead(e.target.value)}
              onBlur={saveLead}
              className="h-9 w-20 rounded-lg border border-line-strong bg-surface px-2 text-right text-sm text-ink"
            />
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <div className="flex-1">
              <p className="text-[15px]">Also before possible outages</p>
              <p className="text-xs text-muted">Slots the schedule marks as possible, and the weekly pattern on days not yet confirmed.</p>
            </div>
            <Switch
              label="Also before possible outages"
              on={settings.possibleOutages}
              onChange={(possibleOutages) => {
                setSettings({ ...settings, possibleOutages });
                void save({ possibleOutages });
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}
