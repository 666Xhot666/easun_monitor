import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { Switch } from '../ui/Switch';
import { OUTAGE_LEAD_MINUTES } from './constants';

export type NotificationKind =
  | 'fault'
  | 'warning'
  | 'grid'
  | 'battery'
  | 'connection'
  | 'schedule'
  | 'outage'
  | 'schedule-unavailable'
  | 'server-heat'
  | 'server-storage'
  | 'server-memory'
  | 'server-agent'
  | 'server-updates'
  | 'summary';
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

/** `server`: for the server's owner and viewers; in the app these are on the Server page. */
const ROWS: { kind: NotificationKind; server?: true }[] = [
  { kind: 'fault' },
  { kind: 'warning' },
  { kind: 'grid' },
  { kind: 'battery' },
  { kind: 'connection' },
  { kind: 'schedule' },
  { kind: 'outage' },
  { kind: 'schedule-unavailable' },
  { kind: 'server-heat', server: true },
  { kind: 'server-storage', server: true },
  { kind: 'server-memory', server: true },
  { kind: 'server-agent', server: true },
  { kind: 'server-updates', server: true },
  { kind: 'summary' },
];

/** What reaches the signed-in user, per kind of alert, in the app and on Telegram. */
export default function NotificationSettings({ showServer = false }: { showServer?: boolean }) {
  const { t } = useTranslation();
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
        if (!cancelled) setError(extractErrorMessage(e, i18n.t('notify.loadFailed')));
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
      setError(extractErrorMessage(e, t('notify.saveFailed')));
    }
  }

  const saveLead = () => {
    if (!settings) return;
    const minutes = Number(lead);
    if (!Number.isInteger(minutes) || minutes < OUTAGE_LEAD_MINUTES.min || minutes > OUTAGE_LEAD_MINUTES.max) {
      setError(t('notify.leadRange', { min: OUTAGE_LEAD_MINUTES.min, max: OUTAGE_LEAD_MINUTES.max }));
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
      <h2 className="text-[15px] font-semibold">{t('notify.title')}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        {t('notify.intro')}
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
                <th scope="col" className="w-16 pb-2 font-semibold">{t('notify.inApp')}</th>
                <th scope="col" className="w-20 pb-2 font-semibold">{t('notify.telegram')}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.filter((row) => showServer || !row.server).map(({ kind, server }) => {
                const label = t(`notify.rows.${kind}.label`);
                return (
                <tr key={kind} className="border-t border-line">
                  <th scope="row" className="py-3 pr-3 text-left font-normal">
                    <span className="block text-[15px]">{label}</span>
                    <span className="block text-xs text-muted">{t(`notify.rows.${kind}.detail`)}</span>
                  </th>
                  <td className="text-center">
                    {server ? (
                      <span className="text-xs text-muted">{t('notify.serverPage')}</span>
                    ) : (
                      <span className="inline-flex">
                        <Switch label={t('notify.inTheApp', { label })} on={settings.channels[kind].inApp} onChange={(on) => set(kind, 'inApp', on)} />
                      </span>
                    )}
                  </td>
                  <td className="text-center">
                    <span className="inline-flex">
                      <Switch
                        label={t('notify.onTelegram', { label })}
                        on={linked && settings.channels[kind].telegram}
                        disabled={!linked}
                        onChange={(on) => set(kind, 'telegram', on)}
                      />
                    </span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {!linked && <p className="mt-2 text-xs text-muted">{t('notify.linkFirst')}</p>}
          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <div className="flex-1">
              <p className="text-[15px]">{t('notify.quietHours')}</p>
              <p className="text-xs text-muted">{t(showServer ? 'notify.quietHintServer' : 'notify.quietHint')}</p>
            </div>
            <Switch
              label={t('notify.quietHours')}
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
                {t('notify.lead')}
              </label>
              <p id="outage-lead-hint" className="text-xs text-muted">
                {t('notify.leadHint')}
              </p>
            </div>
            <input
              id="outage-lead"
              aria-describedby="outage-lead-hint"
              type="number"
              inputMode="numeric"
              min={OUTAGE_LEAD_MINUTES.min}
              max={OUTAGE_LEAD_MINUTES.max}
              value={lead}
              onChange={(e) => setLead(e.target.value)}
              onBlur={saveLead}
              className="h-9 w-20 rounded-lg border border-line-strong bg-surface px-2 text-right text-sm text-ink"
            />
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <div className="flex-1">
              <p className="text-[15px]">{t('notify.possible')}</p>
              <p className="text-xs text-muted">{t('notify.possibleHint')}</p>
            </div>
            <Switch
              label={t('notify.possible')}
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
