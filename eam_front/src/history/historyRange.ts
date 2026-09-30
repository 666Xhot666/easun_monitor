/** Response of GET /api/inverter/:profileId/history. */
export interface History {
  source: 'raw' | 'hourly';
  bucketSeconds: number;
  points: { timestamp: string; values: Record<string, number> }[];
}

export type HistoryRangeId = '1h' | '24h' | '7d' | '30d' | '1y' | '2y';

export interface HistoryRange {
  id: HistoryRangeId;
  label: string;
  spanMs: number;
  /** Points to ask for: roughly one per pixel column of a wide chart. */
  points: number;
  /** date-fns format for axis labels at this zoom level. */
  axisFormat: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const HISTORY_RANGES: readonly HistoryRange[] = [
  { id: '1h', label: '1 h', spanMs: HOUR, points: 360, axisFormat: 'HH:mm' },
  { id: '24h', label: '24 h', spanMs: DAY, points: 288, axisFormat: 'HH:mm' },
  { id: '7d', label: '7 d', spanMs: 7 * DAY, points: 336, axisFormat: 'EEE HH:mm' },
  { id: '30d', label: '30 d', spanMs: 30 * DAY, points: 360, axisFormat: 'MMM d' },
  { id: '1y', label: '1 y', spanMs: 365 * DAY, points: 365, axisFormat: 'MMM yyyy' },
  { id: '2y', label: '2 y', spanMs: 730 * DAY, points: 730, axisFormat: 'MMM yyyy' },
];

export function getRange(id: HistoryRangeId): HistoryRange {
  return HISTORY_RANGES.find((r) => r.id === id) ?? HISTORY_RANGES[1];
}

/** Query-string parameters for a range ending at `now`. */
export function rangeQuery(id: HistoryRangeId, now: Date = new Date()) {
  const range = getRange(id);
  return {
    from: new Date(now.getTime() - range.spanMs).toISOString(),
    to: now.toISOString(),
    points: range.points,
  };
}

export type ChartRow = { at: number } & Record<string, number | null>;

/** One row per bucket; a register absent from a bucket becomes null, so
 * the chart shows a gap instead of a false drop to zero. */
export function toChartRows(history: History, fields: readonly string[]): ChartRow[] {
  return history.points.map((point) => {
    const row: ChartRow = { at: Date.parse(point.timestamp) };
    for (const field of fields) {
      const value = point.values[field];
      row[field] = typeof value === 'number' ? value : null;
    }
    return row;
  });
}
