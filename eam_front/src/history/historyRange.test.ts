import { describe, expect, it } from 'vitest';
import { HISTORY_RANGES, rangeQuery, toChartRows, type History } from './historyRange';

const now = new Date('2026-09-30T12:00:00Z');

describe('rangeQuery', () => {
  it('offers ranges from an hour to two years', () => {
    expect(HISTORY_RANGES.map((r) => r.id)).toEqual(['1h', '24h', '7d', '30d', '1y', '2y']);
  });

  it('ends the range now and starts it one span earlier', () => {
    expect(rangeQuery('24h', now)).toEqual({
      from: '2026-09-29T12:00:00.000Z',
      to: '2026-09-30T12:00:00.000Z',
      points: 288,
    });
    expect(rangeQuery('2y', now).from).toBe('2024-09-30T12:00:00.000Z');
  });
});

describe('toChartRows', () => {
  const history: History = {
    source: 'raw',
    bucketSeconds: 300,
    points: [
      { timestamp: '2026-09-30T10:00:00.000Z', values: { PVPower: 1200, BatteryVoltage: 52.1 } },
      { timestamp: '2026-09-30T10:05:00.000Z', values: { PVPower: 1300 } },
    ],
  };

  it('flattens points into one row per bucket, with null for a missing register', () => {
    const rows = toChartRows(history, ['PVPower', 'BatteryVoltage']);
    expect(rows).toEqual([
      { at: Date.parse('2026-09-30T10:00:00.000Z'), PVPower: 1200, BatteryVoltage: 52.1 },
      { at: Date.parse('2026-09-30T10:05:00.000Z'), PVPower: 1300, BatteryVoltage: null },
    ]);
  });
});
