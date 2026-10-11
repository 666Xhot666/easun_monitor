import type { DaySlots } from '../outage-reader/dnem/schedule-page';
import { buildForecast, type ForecastInput } from './forecast';

// Kyiv is UTC+3 until 25 October 2026. 12 October 2026 is a Monday.
const kyiv = (local: string) => new Date(`${local}+03:00`);
const FROM = kyiv('2026-10-12T00:00:00');
const TO = kyiv('2026-10-14T00:00:00');
const NOW = kyiv('2026-10-12T09:00:00');

const slots = (marks: Record<number, DaySlots[number]> = {}): DaySlots =>
  Array.from({ length: 24 }, (_, hour) => marks[hour] ?? 'yes');

const WEEK = {
  1: slots({ 18: 'no' }),
  2: slots({ 0: 'no', 1: 'no', 20: 'maybe' }),
  3: slots(),
  4: slots(),
  5: slots(),
  6: slots(),
  7: slots(),
};

const schedule = (start: string, end: string, status = 'OFF' as const) => ({
  kind: 'SCHEDULE' as const,
  status,
  description: null,
  start: kyiv(start),
  end: kyiv(end),
});

const input = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  source: { enabled: true, houseState: 'FOUND', groups: ['GPV5.2'] },
  lastCheck: {
    checkedAt: kyiv('2026-10-12T08:30:00'),
    outcome: 'OK',
    error: null,
  },
  lastOkAt: kyiv('2026-10-12T08:30:00'),
  events: [schedule('2026-10-12T08:00:00', '2026-10-12T12:00:00')],
  weekly: { 'GPV5.2': WEEK },
  coveredDays: ['2026-10-12'],
  ...over,
});

describe('buildForecast', () => {
  it('lays the weekly pattern only over days without a confirmed schedule', () => {
    const forecast = buildForecast(input(), FROM, TO, NOW);
    expect(forecast.state).toBe('fresh');
    expect(forecast.groups).toEqual(['GPV5.2']);
    expect(forecast.windows).toEqual([
      {
        start: kyiv('2026-10-12T08:00:00'),
        end: kyiv('2026-10-12T12:00:00'),
        status: 'off',
        source: 'schedule',
        description: null,
      },
      {
        start: kyiv('2026-10-13T00:00:00'),
        end: kyiv('2026-10-13T02:00:00'),
        status: 'off',
        source: 'weekly',
        description: null,
      },
      {
        start: kyiv('2026-10-13T20:00:00'),
        end: kyiv('2026-10-13T21:00:00'),
        status: 'possible',
        source: 'weekly',
        description: null,
      },
    ]);
  });

  it('joins the weekly patterns of a house on several groups', () => {
    const other = { ...WEEK, 2: slots({ 2: 'no' }) };
    const forecast = buildForecast(
      input({
        source: {
          enabled: true,
          houseState: 'FOUND',
          groups: ['GPV5.2', 'GPV1.1'],
        },
        weekly: { 'GPV5.2': WEEK, 'GPV1.1': other },
      }),
      FROM,
      TO,
      NOW,
    );
    expect(forecast.windows[1]).toMatchObject({
      start: kyiv('2026-10-13T00:00:00'),
      end: kyiv('2026-10-13T03:00:00'),
      source: 'weekly',
    });
  });

  it('says what is scheduled now and what comes next', () => {
    const forecast = buildForecast(input(), FROM, TO, NOW);
    expect(forecast.now).toEqual({
      status: 'off',
      window: forecast.windows[0],
    });
    expect(forecast.next).toEqual(forecast.windows[1]);

    const later = buildForecast(input(), FROM, TO, kyiv('2026-10-12T13:00:00'));
    expect(later.now).toEqual({ status: 'on', window: null });
    expect(later.next).toEqual(forecast.windows[1]);
  });

  it('puts a repair on the house before the schedule', () => {
    const repair = {
      kind: 'REPAIR' as const,
      status: 'OFF' as const,
      description: 'Аварійні ремонтні роботи',
      start: kyiv('2026-10-12T08:30:00'),
      end: kyiv('2026-10-12T15:00:00'),
    };
    const forecast = buildForecast(
      input({
        events: [
          schedule(
            '2026-10-12T08:00:00',
            '2026-10-12T12:00:00',
            'POSSIBLE' as 'OFF',
          ),
          repair,
        ],
      }),
      FROM,
      TO,
      NOW,
    );
    expect(forecast.now.window).toMatchObject({
      source: 'repair',
      description: 'Аварійні ремонтні роботи',
    });
    expect(forecast.now.status).toBe('off');
  });

  it('gives the age of the data and calls it stale after 12 hours without a successful check', () => {
    const fresh = buildForecast(input(), FROM, TO, NOW);
    expect(fresh.lastOkAt).toEqual(kyiv('2026-10-12T08:30:00'));
    expect(fresh.dataAgeMinutes).toBe(30);

    const stale = buildForecast(
      input({
        lastOkAt: kyiv('2026-10-11T20:59:00'),
        lastCheck: {
          checkedAt: kyiv('2026-10-12T08:30:00'),
          outcome: 'CHALLENGE',
          error: 'The site answered with a firewall challenge',
        },
      }),
      FROM,
      TO,
      NOW,
    );
    expect(stale.state).toBe('stale');
    expect(stale.lastCheck?.outcome).toBe('CHALLENGE');
    // The last data is still given, marked stale.
    expect(stale.windows).toHaveLength(3);
  });

  it('is stale before any successful check', () => {
    const forecast = buildForecast(
      input({ lastOkAt: null, events: [], weekly: {}, coveredDays: [] }),
      FROM,
      TO,
      NOW,
    );
    expect(forecast.state).toBe('stale');
    expect(forecast.dataAgeMinutes).toBeNull();
    expect(forecast.now).toEqual({ status: 'unknown', window: null });
  });

  it.each([
    ['none', { source: null }],
    [
      'disabled',
      {
        source: {
          enabled: false,
          houseState: 'FOUND' as const,
          groups: ['GPV5.2'],
        },
      },
    ],
    [
      'pending',
      { source: { enabled: true, houseState: 'PENDING' as const, groups: [] } },
    ],
    [
      'not-found',
      {
        source: { enabled: true, houseState: 'NOT_FOUND' as const, groups: [] },
      },
    ],
    [
      'no-groups',
      { source: { enabled: true, houseState: 'FOUND' as const, groups: [] } },
    ],
  ])('has no windows when %s', (state, over) => {
    const forecast = buildForecast(input(over), FROM, TO, NOW);
    expect(forecast.state).toBe(state);
    expect(forecast.windows).toEqual([]);
    expect(forecast.now).toEqual({ status: 'unknown', window: null });
    expect(forecast.next).toBeNull();
  });
});
