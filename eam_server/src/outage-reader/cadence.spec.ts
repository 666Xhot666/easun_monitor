import { nextCheckAt, type Cadence } from './cadence';

// Helsinki keeps the site's clock rules; 2026-10-10 is UTC+3.
const HELSINKI = 'Europe/Helsinki';
const cadence: Cadence = {
  intervalMinutes: 120,
  eveningIntervalMinutes: 30,
  evening: { from: 18 * 60, to: 23 * 60 },
  blockedHours: 6,
};
/** A Helsinki wall time on 2026-10-10 (or the given day) as an instant. */
const local = (hhmm: string, day = '10') => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, Number(day), h - 3, m));
};
const next = (from: Date, blocked = false) =>
  nextCheckAt(from, cadence, { blocked }, HELSINKI).toISOString();

describe('nextCheckAt', () => {
  it('waits the normal interval during the day', () => {
    expect(next(local('10:00'))).toBe(local('12:00').toISOString());
  });

  it('starts the evening checks on time instead of waiting the full interval', () => {
    expect(next(local('17:00'))).toBe(local('18:00').toISOString());
    expect(next(local('16:30'))).toBe(local('18:00').toISOString());
  });

  it('checks more often in the evening', () => {
    expect(next(local('18:00'))).toBe(local('18:30').toISOString());
    expect(next(local('22:45'))).toBe(local('23:15').toISOString());
  });

  it('goes back to the normal interval after the evening', () => {
    expect(next(local('23:30'))).toBe(local('01:30', '11').toISOString());
  });

  it('backs off for hours when the site blocks even the browser', () => {
    expect(next(local('17:00'), true)).toBe(local('23:00').toISOString());
  });
});
