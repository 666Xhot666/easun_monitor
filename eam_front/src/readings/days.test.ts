import { describe, expect, it } from 'vitest';
import { dayLabel, dayRange, daysRange, shiftDay, toDay } from './days';

// Days are the browser's local calendar days, written like <input type="date">.
const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h);

describe('days', () => {
  it('names the local day a moment falls on', () => {
    expect(toDay(local(2026, 10, 6, 23))).toBe('2026-10-06');
  });

  it('spans a day from its local midnight to the next', () => {
    expect(dayRange('2026-10-06')).toEqual({
      from: local(2026, 10, 6).toISOString(),
      to: local(2026, 10, 7).toISOString(),
    });
  });

  it('spans several whole days, both ends included', () => {
    expect(daysRange('2026-10-01', '2026-10-06')).toEqual({
      from: local(2026, 10, 1).toISOString(),
      to: local(2026, 10, 7).toISOString(),
    });
  });

  it('steps a day back and forth, across months', () => {
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('calls recent days Today and Yesterday, others by date', () => {
    const today = '2026-10-06';
    expect(dayLabel('2026-10-06', today)).toBe('Today');
    expect(dayLabel('2026-10-05', today)).toBe('Yesterday');
    expect(dayLabel('2026-10-01', today)).toBe('Thu, 1 Oct 2026');
  });
});
