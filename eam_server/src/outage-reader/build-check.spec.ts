import { buildCheck, sameHouse } from './build-check';
import type { StreetReading } from './dnem/read-street';
import type { DaySlots } from './dnem/schedule-page';

const day = (set: Record<number, string> = {}) =>
  Array.from({ length: 24 }, (_, h) => set[h] ?? 'yes') as DaySlots;
const week = (fill = day()) =>
  Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, fill]));

// Local midnights: 2026-10-10 and 2026-10-11 (UTC+3).
const SAT = 1791579600;
const SUN = 1791666000;

const reading = (over: Partial<StreetReading> = {}): StreetReading => ({
  usedBrowser: false,
  page: {
    ajaxUrl: 'https://outage-site.test/ua/ajax',
    csrfToken: 't',
    streets: { 'м. Тестове': ['вул. Тестова'] },
    weekly: {
      groupNames: { 'GPV5.2': 'Черга 5.2', 'GPV1.1': 'Черга 1.1' },
      groups: { 'GPV5.2': week(day({ 8: 'maybe' })), 'GPV1.1': week() },
    },
    confirmed: {
      today: SAT,
      updated: '10.10.2026 20:40',
      days: {
        [SAT]: { 'GPV5.2': day(), 'GPV1.1': day({ 3: 'no' }) },
        [SUN]: { 'GPV1.1': day() },
      },
    },
  },
  houses: {
    '12а': { groups: ['GPV5.2'], outage: null },
    '14': {
      groups: ['GPV5.2'],
      outage: {
        description: 'Аварійні ремонтні роботи',
        type: '2',
        start: new Date('2026-10-10T15:05:00Z'),
        end: new Date('2026-10-10T19:05:00Z'),
      },
    },
  },
  ...over,
});

const at = new Date('2026-10-10T17:00:00Z');

describe('buildCheck', () => {
  it("sends the house, and only its groups' weekly pattern and confirmed days", () => {
    expect(buildCheck(reading(), '12а', at)).toEqual({
      checkedAt: '2026-10-10T17:00:00.000Z',
      outcome: 'ok',
      usedBrowser: false,
      house: { found: true, groups: ['GPV5.2'], outage: null },
      weekly: {
        'GPV5.2': Object.fromEntries(
          [1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), day({ 8: 'maybe' })]),
        ),
      },
      confirmed: {
        updated: '10.10.2026 20:40',
        days: { '2026-10-10': { 'GPV5.2': day() } },
      },
    });
  });

  it("sends the house's current outage", () => {
    const check = buildCheck(reading(), '14', at);
    expect(check.house).toEqual({
      found: true,
      groups: ['GPV5.2'],
      outage: {
        description: 'Аварійні ремонтні роботи',
        type: '2',
        start: '2026-10-10T15:05:00.000Z',
        end: '2026-10-10T19:05:00.000Z',
      },
    });
  });

  it('says so when the house is not on the street', () => {
    const check = buildCheck(reading(), '99', at);
    expect(check.house).toEqual({ found: false });
    expect(check.weekly).toEqual({});
    expect(check.confirmed).toEqual({ updated: '10.10.2026 20:40', days: {} });
  });

  it('notes the browser when the reading came through it', () => {
    expect(
      buildCheck(reading({ usedBrowser: true }), '12а', at).usedBrowser,
    ).toBe(true);
  });
});

describe('sameHouse', () => {
  it('ignores case, spaces and Latin letters that look Cyrillic', () => {
    expect(sameHouse('12a', '12а')).toBe(true); // Latin a vs Cyrillic а
    expect(sameHouse(' 12 А ', '12а')).toBe(true);
    expect(sameHouse('7K', '7к')).toBe(true);
    expect(sameHouse('12б', '12а')).toBe(false);
    expect(sameHouse('12', '120')).toBe(false);
  });
});
