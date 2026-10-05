import { describe, expect, it } from 'vitest';
import { flowFreshness, formatAge } from './freshness';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('flowFreshness', () => {
  it('is offline without a reading', () => {
    expect(flowFreshness(undefined, NOW, 15_000)).toBe('offline');
  });

  it('is live until the reading is older than the stale limit', () => {
    expect(flowFreshness(ago(15_000), NOW, 15_000)).toBe('live');
    expect(flowFreshness(ago(15_001), NOW, 15_000)).toBe('stale');
  });
});

describe('formatAge', () => {
  it('says how long ago in the largest whole unit', () => {
    expect(formatAge(4_000)).toBe('4s');
    expect(formatAge(125_000)).toBe('2m');
    expect(formatAge(3 * 3_600_000 + 5)).toBe('3h');
    expect(formatAge(50 * 3_600_000)).toBe('2d');
  });
});
