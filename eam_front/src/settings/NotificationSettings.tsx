import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { Switch } from '../ui/Switch';

export type NotificationKind = 'fault' | 'warning' | 'grid' | 'battery' | 'connection' | 'summary';
interface Channels {
  inApp: boolean;
  telegram: boolean;
}
/** GET/PUT /api/notifications/settings. */
export interface NotificationSettingsValue {
  channels: Record<NotificationKind, Channels>;
  quietHours: boolean;
}

const ROWS: { kind: NotificationKind; label: string; detail: string }[] = [
  { kind: 'fault', label: 'Faults', detail: 'Inverter faults and fault mode, as they happen' },
  { kind: 'warning', label: 'Warnings', detail: 'Inverter warnings and BMS alarms' },
  { kind: 'grid', label: 'Grid lost and restored', detail: 'With how long the outage lasted' },
  { kind: 'battery', label: 'Battery low', detail: 'When the state of charge drops to the low level' },
  { kind: 'connection', label: 'Logger or BMS reader offline', detail: 'When there are no readings for 5 minutes' },
  { kind: 'summary', label: 'Daily summary', detail: 'In the evening: solar, grid, load, self-sufficiency' },
];

/** What reaches the signed-in user, per kind of alert, in the app and on Telegram. */
export default function NotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettingsValue | null>(null);
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState('');

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
        </>
      )}
    </section>
  );
}
