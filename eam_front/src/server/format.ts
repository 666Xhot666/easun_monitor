/** "8.0 GB", "250 GB": decimal units, as disks are sold. */
export function bytes(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e11) return `${Math.round(n / 1e9)} GB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
  return `${Math.round(n)} B`;
}

/** "1.2 kB/s", "300 B/s", "—" when not known yet. */
export function rate(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB/s`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} kB/s`;
  return `${Math.round(n)} B/s`;
}

/** "3 d 4 h", "5 h 12 min", "7 min". */
export function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}
