import i18n from '../i18n';

/** "off", "low", "high" for a fan with three speeds; null when it has no fixed speeds. */
export function speedName(percent: number, steps: number | null): string | null {
  if (!steps || steps < 2 || !Number.isFinite(percent)) return null;
  const level = Math.round((Math.min(100, Math.max(0, percent)) / 100) * (steps - 1));
  if (level === 0) return i18n.t('server.fanPanel.speeds.off');
  if (steps === 3) return i18n.t(level === 1 ? 'server.fanPanel.speeds.low' : 'server.fanPanel.speeds.high');
  return i18n.t('server.fanPanel.speeds.level', { level, of: steps - 1 });
}
