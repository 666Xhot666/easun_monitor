import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import { lastSeenAlert, SEEN_EVENT } from './seen';

const REFRESH_MS = 60_000;
const NEWEST = 20;

/** How many of the newest alerts, of the kinds the user wants in the app, this browser hasn't shown on the Alerts page (at most 20). */
export function useUnreadAlerts(profileId: number): number {
  const [alerts, setAlerts] = useState<{ id: number; kind: string }[]>([]);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState(() => lastSeenAlert(profileId));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await axios.get<{ id: number; kind: string }[]>(`/api/inverter/${profileId}/alerts`, {
          params: { limit: NEWEST },
        });
        if (!cancelled) setAlerts(data);
      } catch {
        // The bell just stays as it was.
      }
    };
    void load();
    // Kinds switched off "in the app" don't count; without the settings, everything does.
    axios
      .get<{ channels: Record<string, { inApp: boolean }> }>('/api/notifications/settings')
      .then(({ data }) => {
        if (!cancelled) setMuted(new Set(Object.entries(data.channels).filter(([, c]) => !c.inApp).map(([kind]) => kind)));
      })
      .catch(() => {});
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onSeen = () => setSeen(lastSeenAlert(profileId));
    window.addEventListener(SEEN_EVENT, onSeen);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(SEEN_EVENT, onSeen);
    };
  }, [profileId]);

  return alerts.filter((a) => a.id > seen && !muted.has(a.kind)).length;
}
