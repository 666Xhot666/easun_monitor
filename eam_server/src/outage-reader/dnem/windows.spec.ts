import type { DaySlots } from './schedule-page';
import type { SlotStatus } from './slot-status';
import {
  confirmedWindows,
  dayWindows,
  mergeWindows,
  weeklyWindows,
  type OutageWindow,
} from './windows';

// Helsinki keeps the same EET/EEST rules as the site's zone and they are settled law, so
// exact UTC times around daylight saving are tested there.
const HELSINKI = 'Europe/Helsinki';

/** 24 hourly statuses, `yes` unless set: { hour (0-23): status }. */
const day = (set: Record<number, SlotStatus> = {}): DaySlots =>
  Array.from({ length: 24 }, (_, h) => set[h] ?? 'yes');

const iso = (w: OutageWindow) => [
  w.start.toISOString(),
  w.end.toISOString(),
  w.status,
  w.source,
];

describe('dayWindows', () => {
  const sat = { year: 2026, month: 10, day: 10 }; // EEST, UTC+3

  it('turns outage hours into windows in UTC, joining neighbouring hours', () => {
    const windows = dayWindows(
      sat,
      day({ 18: 'no', 19: 'no' }),
      'confirmed',
      HELSINKI,
    );
    expect(windows.map(iso)).toEqual([
      [
        '2026-10-10T15:00:00.000Z',
        '2026-10-10T17:00:00.000Z',
        'off',
        'confirmed',
      ],
    ]);
  });

  it('uses the first or second 30 minutes for half-hour statuses', () => {
    const windows = dayWindows(
      sat,
      day({ 6: 'first', 17: 'second', 18: 'no', 19: 'first' }),
      'confirmed',
      HELSINKI,
    );
    expect(windows.map(iso)).toEqual([
      [
        '2026-10-10T03:00:00.000Z',
        '2026-10-10T03:30:00.000Z',
        'off',
        'confirmed',
      ],
      [
        '2026-10-10T14:30:00.000Z',
        '2026-10-10T16:30:00.000Z',
        'off',
        'confirmed',
      ],
    ]);
  });

  it('keeps possible, definite and unknown hours apart', () => {
    const windows = dayWindows(
      sat,
      day({ 8: 'maybe', 9: 'no', 10: 'mfirst', 12: 'msecond', 13: 'unknown' }),
      'weekly',
      HELSINKI,
    );
    expect(windows.map(iso)).toEqual([
      [
        '2026-10-10T05:00:00.000Z',
        '2026-10-10T06:00:00.000Z',
        'possible',
        'weekly',
      ],
      ['2026-10-10T06:00:00.000Z', '2026-10-10T07:00:00.000Z', 'off', 'weekly'],
      [
        '2026-10-10T07:00:00.000Z',
        '2026-10-10T07:30:00.000Z',
        'possible',
        'weekly',
      ],
      [
        '2026-10-10T09:30:00.000Z',
        '2026-10-10T10:00:00.000Z',
        'possible',
        'weekly',
      ],
      [
        '2026-10-10T10:00:00.000Z',
        '2026-10-10T11:00:00.000Z',
        'unknown',
        'weekly',
      ],
    ]);
  });

  it('has no windows for a day with power all day', () => {
    expect(dayWindows(sat, day(), 'confirmed', HELSINKI)).toEqual([]);
  });

  it('drops the hour that does not exist when clocks go forward', () => {
    // 2026-03-29: 03:00 EET jumps to 04:00 EEST.
    const windows = dayWindows(
      { year: 2026, month: 3, day: 29 },
      day({ 2: 'no', 3: 'no', 4: 'no' }),
      'confirmed',
      HELSINKI,
    );
    expect(windows.map(iso)).toEqual([
      [
        '2026-03-29T00:00:00.000Z',
        '2026-03-29T02:00:00.000Z',
        'off',
        'confirmed',
      ],
    ]);
  });

  it('covers both runs of the repeated hour when clocks go back', () => {
    // 2026-10-25: 04:00 EEST goes back to 03:00 EET; 03:00-04:00 happens twice.
    const windows = dayWindows(
      { year: 2026, month: 10, day: 25 },
      day({ 3: 'no' }),
      'confirmed',
      HELSINKI,
    );
    expect(windows.map(iso)).toEqual([
      [
        '2026-10-25T00:00:00.000Z',
        '2026-10-25T02:00:00.000Z',
        'off',
        'confirmed',
      ],
    ]);
  });

  it('works in the site time zone', () => {
    // January: UTC+2 whether or not Ukraine keeps daylight saving.
    const windows = dayWindows(
      { year: 2027, month: 1, day: 15 },
      day({ 0: 'no', 23: 'no' }),
      'confirmed',
    );
    expect(windows.map(iso)).toEqual([
      [
        '2027-01-14T22:00:00.000Z',
        '2027-01-14T23:00:00.000Z',
        'off',
        'confirmed',
      ],
      [
        '2027-01-15T21:00:00.000Z',
        '2027-01-15T22:00:00.000Z',
        'off',
        'confirmed',
      ],
    ]);
  });
});

describe('mergeWindows', () => {
  const w = (
    start: string,
    end: string,
    status: OutageWindow['status'] = 'off',
  ): OutageWindow => ({
    start: new Date(start),
    end: new Date(end),
    status,
    source: 'weekly',
  });

  it('joins windows that touch and have the same status and source, in time order', () => {
    const merged = mergeWindows([
      w('2026-10-11T21:00Z', '2026-10-11T22:00Z'),
      w('2026-10-11T19:00Z', '2026-10-11T21:00Z'),
      w('2026-10-11T22:00Z', '2026-10-11T23:00Z', 'possible'),
      w('2026-10-12T01:00Z', '2026-10-12T02:00Z'),
    ]);
    expect(merged.map(iso)).toEqual([
      ['2026-10-11T19:00:00.000Z', '2026-10-11T22:00:00.000Z', 'off', 'weekly'],
      [
        '2026-10-11T22:00:00.000Z',
        '2026-10-11T23:00:00.000Z',
        'possible',
        'weekly',
      ],
      ['2026-10-12T01:00:00.000Z', '2026-10-12T02:00:00.000Z', 'off', 'weekly'],
    ]);
  });
});

describe('weeklyWindows', () => {
  // Weekday 1 = Monday ... 7 = Sunday, as the site numbers them.
  const week: Record<number, DaySlots> = {
    1: day({ 0: 'no', 1: 'no', 10: 'maybe' }),
    2: day(),
    3: day(),
    4: day(),
    5: day(),
    6: day({ 8: 'no' }),
    7: day({ 22: 'no', 23: 'no' }),
  };

  it('repeats the pattern by weekday over a range, across midnight, clipped to it', () => {
    // Sat 2026-10-10 08:30 EEST to Mon 2026-10-12 10:30 EEST.
    const windows = weeklyWindows(
      week,
      new Date('2026-10-10T05:30:00Z'),
      new Date('2026-10-12T07:30:00Z'),
      HELSINKI,
    );
    expect(windows.map(iso)).toEqual([
      ['2026-10-10T05:30:00.000Z', '2026-10-10T06:00:00.000Z', 'off', 'weekly'],
      ['2026-10-11T19:00:00.000Z', '2026-10-11T23:00:00.000Z', 'off', 'weekly'],
      [
        '2026-10-12T07:00:00.000Z',
        '2026-10-12T07:30:00.000Z',
        'possible',
        'weekly',
      ],
    ]);
  });

  it('is empty for an empty range', () => {
    const at = new Date('2026-10-10T05:30:00Z');
    expect(weeklyWindows(week, at, at, HELSINKI)).toEqual([]);
  });
});

describe('confirmedWindows', () => {
  // Local midnights as the site sends them (EEST, UTC+3).
  const sat = 1791579600; // 2026-10-10
  const sun = 1791666000; // 2026-10-11
  const days = {
    [sat]: {
      'GPV5.2': day({ 20: 'no', 21: 'no', 22: 'no', 23: 'no' }),
      'GPV1.1': day({ 1: 'no' }),
    },
    [sun]: { 'GPV5.2': day({ 0: 'no', 5: 'maybe' }), 'GPV1.1': day() },
  };

  it("lists a group's windows across the published days, and which days are covered", () => {
    const { windows, coveredDays } = confirmedWindows(
      days,
      ['GPV5.2'],
      HELSINKI,
    );
    expect(windows.map(iso)).toEqual([
      [
        '2026-10-10T17:00:00.000Z',
        '2026-10-10T22:00:00.000Z',
        'off',
        'confirmed',
      ],
      [
        '2026-10-11T02:00:00.000Z',
        '2026-10-11T03:00:00.000Z',
        'possible',
        'confirmed',
      ],
    ]);
    expect(coveredDays).toEqual([
      { year: 2026, month: 10, day: 10 },
      { year: 2026, month: 10, day: 11 },
    ]);
  });

  it('only covers the days published for the group', () => {
    const { windows, coveredDays } = confirmedWindows(
      { [sat]: days[sat] },
      ['GPV9.9'],
      HELSINKI,
    );
    expect(windows).toEqual([]);
    expect(coveredDays).toEqual([]);
  });

  it('combines several groups, as for a house on more than one', () => {
    const { windows } = confirmedWindows(
      { [sat]: days[sat] },
      ['GPV5.2', 'GPV1.1'],
      HELSINKI,
    );
    expect(windows.map(iso)).toEqual([
      [
        '2026-10-09T22:00:00.000Z',
        '2026-10-09T23:00:00.000Z',
        'off',
        'confirmed',
      ],
      [
        '2026-10-10T17:00:00.000Z',
        '2026-10-10T21:00:00.000Z',
        'off',
        'confirmed',
      ],
    ]);
  });
});
