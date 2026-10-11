import type { Cadence } from './cadence';

export interface OutageReaderConfig {
  server: { url: string; token: string };
  cadence: Cadence;
  browserEveryDays: number;
  stateFile: string;
}

export function outageReaderConfig(
  env: Record<string, string | undefined>,
): OutageReaderConfig {
  const url = env.OUTAGE_SERVER_URL?.trim();
  if (!url)
    throw new Error(
      'OUTAGE_SERVER_URL is required: the server the reader reports to, e.g. http://localhost:3000',
    );
  const token = env.OUTAGE_READER_TOKEN?.trim();
  if (!token)
    throw new Error(
      'OUTAGE_READER_TOKEN is required: set the outage schedule address in the app to get one',
    );

  function minutes(name: string, fallback: number, min: number): number {
    const value = env[name]?.trim();
    if (!value) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min)
      throw new Error(`${name} must be a whole number of at least ${min}`);
    return n;
  }

  const intervalMinutes = minutes('OUTAGE_INTERVAL_MINUTES', 120, 30);
  const eveningIntervalMinutes = minutes(
    'OUTAGE_EVENING_INTERVAL_MINUTES',
    30,
    15,
  );
  const blockedHours = minutes('OUTAGE_BLOCKED_HOURS', 6, 1);
  const browserEveryDays = minutes('OUTAGE_BROWSER_EVERY_DAYS', 7, 1);

  const eveningRaw = env.OUTAGE_EVENING?.trim() || '18:00-23:00';
  const match = eveningRaw.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!match) throw new Error('OUTAGE_EVENING must look like 18:00-23:00');
  const h1 = Number(match[1]);
  const m1 = Number(match[2]);
  const h2 = Number(match[3]);
  const m2 = Number(match[4]);
  if (h1 > 23 || m1 > 59 || h2 > 23 || m2 > 59)
    throw new Error('OUTAGE_EVENING must look like 18:00-23:00');
  const from = h1 * 60 + m1;
  const to = h2 * 60 + m2;
  if (from >= to) throw new Error('OUTAGE_EVENING must look like 18:00-23:00');

  const stateFile =
    env.OUTAGE_STATE_FILE?.trim() || '.outage-reader-state.json';

  return {
    server: { url, token },
    cadence: {
      intervalMinutes,
      eveningIntervalMinutes,
      evening: { from, to },
      blockedHours,
    },
    browserEveryDays,
    stateFile,
  };
}
