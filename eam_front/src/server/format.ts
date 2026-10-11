import i18n from '../i18n';
import { num } from '../i18n/format';

const u = (key: string) => i18n.t(`units.${key}`);

/** "8.0 GB", "250 GB": decimal units, as disks are sold. */
export function bytes(n: number): string {
  if (n >= 1e12) return `${num(n / 1e12, 1)} ${u('TB')}`;
  if (n >= 1e11) return `${num(Math.round(n / 1e9))} ${u('GB')}`;
  if (n >= 1e9) return `${num(n / 1e9, 1)} ${u('GB')}`;
  if (n >= 1e6) return `${num(Math.round(n / 1e6))} ${u('MB')}`;
  if (n >= 1e3) return `${num(Math.round(n / 1e3))} ${u('kB')}`;
  return `${num(Math.round(n))} ${u('B')}`;
}

/** "1.2 kB/s", "300 B/s", "—" when not known yet. */
export function rate(n: number | null): string {
  if (n === null) return '—';
  const perSecond = `/${u('s')}`;
  if (n >= 1e6) return `${num(n / 1e6, 1)} ${u('MB')}${perSecond}`;
  if (n >= 1e3) return `${num(n / 1e3, 1)} ${u('kB')}${perSecond}`;
  return `${num(Math.round(n))} ${u('B')}${perSecond}`;
}

/** "3 d 4 h", "5 h 12 min", "7 min". */
export function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return i18n.t('server.uptime.days', { d, h });
  if (h > 0) return i18n.t('server.uptime.hours', { h, m });
  return i18n.t('server.uptime.minutes', { m });
}
