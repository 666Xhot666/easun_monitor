import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * A stored time series: raw rows with a JSON `payload` per timestamp, and
 * an hourly table of the payload's numeric averages kept by `rollUpSeries`.
 * Shared by the inverter readings and the BMS readings. Names are
 * constants from this codebase, never user input.
 */
export interface SeriesTables {
  raw: string;
  hourly: string;
  /** The column (quoted) both tables use for the series owner. */
  key: string;
}

export const INVERTER_SERIES: SeriesTables = {
  raw: 'inverter_logs',
  hourly: 'inverter_log_hourly',
  key: '"inverterProfileId"',
};

export interface HistoryQuery {
  from: Date;
  to: Date;
  /** Upper bound on returned points; the bucket size is derived from it. */
  maxPoints: number;
  /** Payload field names to include; all numeric fields when omitted. */
  fields?: string[];
}

export interface HistoryPoint {
  /** Bucket start, ISO 8601. */
  timestamp: string;
  /** Average of each field over the bucket. */
  values: Record<string, number>;
}

export interface History {
  /** Where the averages came from: raw readings, or hourly rollups. */
  source: 'raw' | 'hourly';
  bucketSeconds: number;
  /** Buckets that contain data, oldest first. */
  points: HistoryPoint[];
}

/** Bucket sizes a chart can snap to, in seconds. */
const BUCKETS = [
  5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200,
  86400, 172800, 604800, 1209600, 2592000,
];
const HOUR_SECONDS = 3600;

interface BucketRow {
  bucket: Date;
  key: string;
  value: number;
}

/**
 * Averages of the series' numeric fields over a range, downsampled to at
 * most `maxPoints` buckets: from raw rows for buckets under an hour, from
 * the hourly table otherwise.
 */
export async function seriesHistory(
  prisma: PrismaService,
  tables: SeriesTables,
  owner: number,
  query: HistoryQuery,
): Promise<History> {
  const spanSeconds = (query.to.getTime() - query.from.getTime()) / 1000;
  const wanted = spanSeconds / Math.max(1, query.maxPoints);
  const bucketSeconds =
    BUCKETS.find((b) => b >= wanted) ?? BUCKETS[BUCKETS.length - 1];
  const source = bucketSeconds >= HOUR_SECONDS ? 'hourly' : 'raw';

  const from = query.from.toISOString();
  const to = query.to.toISOString();
  const fieldFilter = query.fields?.length
    ? Prisma.sql`AND kv.key = ANY(${query.fields}::text[])`
    : Prisma.empty;
  const raw = Prisma.raw(tables.raw);
  const hourly = Prisma.raw(tables.hourly);
  const key = Prisma.raw(tables.key);

  const rows =
    source === 'raw'
      ? await prisma.$queryRaw<BucketRow[]>`
          SELECT date_bin(make_interval(secs => ${bucketSeconds}), l."timestamp", ${from}::timestamp) AS bucket,
                 kv.key AS key,
                 avg((kv.value #>> '{}')::float8) AS value
          FROM ${raw} l
          CROSS JOIN LATERAL jsonb_each(l.payload) kv
          WHERE l.${key} = ${owner}
            AND l."timestamp" >= ${from}::timestamp
            AND l."timestamp" < ${to}::timestamp
            AND jsonb_typeof(kv.value) = 'number'
            ${fieldFilter}
          GROUP BY 1, 2
          ORDER BY 1`
      : await prisma.$queryRaw<BucketRow[]>`
          SELECT date_bin(make_interval(secs => ${bucketSeconds}), h.hour, ${from}::timestamp) AS bucket,
                 kv.key AS key,
                 sum((kv.value #>> '{}')::float8 * h.samples) / sum(h.samples) AS value
          FROM ${hourly} h
          CROSS JOIN LATERAL jsonb_each(h.averages) kv
          WHERE h.${key} = ${owner}
            AND h.hour >= ${from}::timestamp
            AND h.hour < ${to}::timestamp
            AND jsonb_typeof(kv.value) = 'number'
            ${fieldFilter}
          GROUP BY 1, 2
          ORDER BY 1`;

  return { source, bucketSeconds, points: toPoints(rows) };
}

/**
 * Brings the hourly table up to date: recomputes every hour from one hour
 * before the newest rollup onwards (so the current, still-filling hour is
 * refreshed), or everything on the first run. Idempotent, and never
 * touches raw rows. Returns the number of hours written.
 */
export async function rollUpSeries(
  prisma: PrismaService,
  tables: SeriesTables,
): Promise<number> {
  const raw = Prisma.raw(tables.raw);
  const hourly = Prisma.raw(tables.hourly);
  const key = Prisma.raw(tables.key);
  const [{ since }] = await prisma.$queryRaw<{ since: Date | null }[]>`
      SELECT max(hour) - interval '1 hour' AS since FROM ${hourly}`;
  const sinceSql = since
    ? Prisma.sql`${since.toISOString()}::timestamp`
    : Prisma.sql`'-infinity'::timestamp`;

  return prisma.$executeRaw`
      WITH hours AS (
        SELECT ${key} AS owner, date_trunc('hour', "timestamp") AS hour, count(*)::int AS samples
        FROM ${raw}
        WHERE ${key} IS NOT NULL AND "timestamp" >= ${sinceSql}
        GROUP BY 1, 2
      ), averages AS (
        SELECT l.${key} AS owner, date_trunc('hour', l."timestamp") AS hour,
               kv.key AS key, avg((kv.value #>> '{}')::float8) AS value
        FROM ${raw} l
        CROSS JOIN LATERAL jsonb_each(l.payload) kv
        WHERE l.${key} IS NOT NULL AND l."timestamp" >= ${sinceSql}
          AND jsonb_typeof(kv.value) = 'number'
        GROUP BY 1, 2, 3
      )
      INSERT INTO ${hourly} (${key}, hour, samples, averages)
      SELECT h.owner, h.hour, h.samples,
             COALESCE(jsonb_object_agg(a.key, a.value) FILTER (WHERE a.key IS NOT NULL), '{}'::jsonb)
      FROM hours h
      LEFT JOIN averages a ON a.owner = h.owner AND a.hour = h.hour
      GROUP BY h.owner, h.hour, h.samples
      ON CONFLICT (${key}, hour)
      DO UPDATE SET samples = EXCLUDED.samples, averages = EXCLUDED.averages`;
}

function toPoints(rows: BucketRow[]): HistoryPoint[] {
  const points = new Map<number, HistoryPoint>();
  for (const row of rows) {
    const time = row.bucket.getTime();
    let point = points.get(time);
    if (!point) {
      point = { timestamp: row.bucket.toISOString(), values: {} };
      points.set(time, point);
    }
    point.values[row.key] = Math.round(Number(row.value) * 10_000) / 10_000;
  }
  return [...points.values()];
}
