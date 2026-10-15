import { useEffect, useState } from 'react';
import i18n from '../i18n';

/** "5 s", "4 min", "3 h", "2 d": how long ago, in its largest whole unit. */
export function ageText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return i18n.t('age.seconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return i18n.t('age.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t('age.hours', { count: hours });
  return i18n.t('age.days', { count: Math.floor(hours / 24) });
}

/** The current time, updated every `intervalMs`: for "updated 5 s ago" text that keeps counting. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
