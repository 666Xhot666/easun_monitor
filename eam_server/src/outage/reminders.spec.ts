import type { ForecastWindow } from './forecast';
import { reminderText, remindersDue, type Member } from './reminders';

const kyiv = (local: string) => new Date(`${local}+03:00`);
const TZ = 'Europe/Kyiv';
const NOW = kyiv('2026-10-12T17:45:00');

const window = (
  start: string,
  end: string,
  over: Partial<ForecastWindow> = {},
): ForecastWindow => ({
  start: kyiv(start),
  end: kyiv(end),
  status: 'off',
  source: 'schedule',
  description: null,
  ...over,
});
const confirmed = window('2026-10-12T18:00:00', '2026-10-12T20:00:00');
const possible = window('2026-10-12T18:00:00', '2026-10-12T19:00:00', {
  status: 'possible',
});
const weekly = window('2026-10-12T18:00:00', '2026-10-12T19:00:00', {
  source: 'weekly',
});

const member = (over: Partial<Member> = {}): Member => ({
  userId: 1,
  leadMinutes: 15,
  possible: false,
  ...over,
});

describe('remindersDue', () => {
  it('is due once the lead time before the start has come', () => {
    expect(remindersDue([confirmed], [member()], NOW)).toEqual([
      { window: confirmed, userId: 1 },
    ]);
    expect(
      remindersDue([confirmed], [member()], kyiv('2026-10-12T17:44:59')),
    ).toEqual([]);
    // Started already: too late.
    expect(
      remindersDue([confirmed], [member()], kyiv('2026-10-12T18:00:00')),
    ).toEqual([]);
  });

  it("follows each member's own lead time", () => {
    const due = remindersDue(
      [confirmed],
      [
        member(),
        member({ userId: 2, leadMinutes: 30 }),
        member({ userId: 3, leadMinutes: 5 }),
      ],
      NOW,
    );
    expect(due.map((d) => d.userId)).toEqual([1, 2]);
  });

  it('reminds of possible outages and the weekly pattern only to those who asked', () => {
    const members = [member(), member({ userId: 2, possible: true })];
    expect(remindersDue([possible, weekly], members, NOW)).toEqual([
      { window: possible, userId: 2 },
      { window: weekly, userId: 2 },
    ]);
  });

  it('never reminds of unclear slots', () => {
    const unclear = { ...confirmed, status: 'unknown' as const };
    expect(remindersDue([unclear], [member({ possible: true })], NOW)).toEqual(
      [],
    );
  });
});

describe('reminderText', () => {
  it('says when and how long, with the battery level', () => {
    expect(
      reminderText(confirmed, NOW, { soc: 64, staleHours: null }, TZ, 'en'),
    ).toBe('Outage in 15 min: 18:00–20:00\nBattery 64 %');
  });

  it('names a repair, a possible outage and the weekly pattern', () => {
    const repair = {
      ...confirmed,
      source: 'repair' as const,
      description: 'Аварійні ремонтні роботи',
    };
    const none = { soc: null, staleHours: null };
    expect(reminderText(repair, NOW, none, TZ, 'en')).toBe(
      'Outage in 15 min: 18:00–20:00, repair on the house: Аварійні ремонтні роботи',
    );
    expect(reminderText(possible, NOW, none, TZ, 'en')).toBe(
      'Possible outage in 15 min: 18:00–19:00',
    );
    expect(reminderText(weekly, NOW, none, TZ, 'en')).toBe(
      'Possible outage in 15 min: 18:00–19:00 (weekly pattern, not confirmed)',
    );
  });

  it('speaks Ukrainian', () => {
    expect(
      reminderText(weekly, NOW, { soc: 64, staleHours: 14 }, TZ, 'uk'),
    ).toBe(
      'Можливе відключення через 15 хв: 18:00–19:00 (за тижневим шаблоном, не підтверджено)\nАкумулятор 64 %\nГрафік востаннє перевірено 14 год тому',
    );
  });

  it('says how old the schedule is when it is stale', () => {
    expect(
      reminderText(confirmed, NOW, { soc: null, staleHours: 14 }, TZ, 'en'),
    ).toBe(
      'Outage in 15 min: 18:00–20:00\nThe schedule was last checked 14 h ago',
    );
  });
});
