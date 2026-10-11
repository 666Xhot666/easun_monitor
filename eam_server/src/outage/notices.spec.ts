import { scheduleUpdateText, type ScheduleChange } from './notices';

// Kyiv is UTC+3 until 25 October 2026. 12 October 2026 is a Monday.
const kyiv = (local: string) => new Date(`${local}+03:00`);
const NOW = kyiv('2026-10-12T20:40:00');
const TZ = 'Europe/Kyiv';

describe('scheduleUpdateText', () => {
  it('lists every change of one check, old → new', () => {
    const changes: ScheduleChange[] = [
      { type: 'published', day: '2026-10-13' },
      {
        type: 'new',
        kind: 'SCHEDULE',
        status: 'OFF',
        start: kyiv('2026-10-13T18:00:00'),
        end: kyiv('2026-10-13T20:00:00'),
        description: null,
      },
      {
        type: 'new',
        kind: 'SCHEDULE',
        status: 'POSSIBLE',
        start: kyiv('2026-10-12T22:00:00'),
        end: kyiv('2026-10-12T23:00:00'),
        description: null,
      },
      {
        type: 'revised',
        kind: 'SCHEDULE',
        status: 'OFF',
        before: {
          start: kyiv('2026-10-12T21:00:00'),
          end: kyiv('2026-10-12T22:00:00'),
        },
        start: kyiv('2026-10-12T21:00:00'),
        end: kyiv('2026-10-12T22:30:00'),
        description: null,
      },
      {
        type: 'withdrawn',
        kind: 'SCHEDULE',
        status: 'OFF',
        start: kyiv('2026-10-14T00:00:00'),
        end: kyiv('2026-10-14T02:00:00'),
        description: null,
      },
      {
        type: 'new',
        kind: 'REPAIR',
        status: 'OFF',
        start: kyiv('2026-10-12T21:10:00'),
        end: kyiv('2026-10-13T03:00:00'),
        description: 'Аварійні ремонтні роботи',
      },
    ];
    expect(scheduleUpdateText(changes, NOW, TZ, 'en')).toBe(
      [
        'Outage schedule updated',
        'Schedule for tomorrow (Tue 13 Oct) published',
        'Today 21:00–22:00 → 21:00–22:30 off',
        'Today 21:10–tomorrow 03:00 repair on the house: Аварійні ремонтні роботи',
        'Today 22:00–23:00 possible outage (new)',
        'Tomorrow 18:00–20:00 off (new)',
        'Wed 14 Oct 00:00–02:00 off cancelled',
      ].join('\n'),
    );
    expect(scheduleUpdateText(changes, NOW, TZ, 'uk')).toBe(
      [
        'Графік відключень оновлено',
        'Опубліковано графік на завтра (вт, 13 жовт.)',
        'Сьогодні 21:00–22:00 → 21:00–22:30 відключення',
        'Сьогодні 21:10–завтра 03:00 ремонт на будинку: Аварійні ремонтні роботи',
        'Сьогодні 22:00–23:00 можливе відключення (нове)',
        'Завтра 18:00–20:00 відключення (нове)',
        'Ср, 14 жовт. 00:00–02:00 відключення скасовано',
      ].join('\n'),
    );
  });

  it('says a published day has no outages', () => {
    expect(
      scheduleUpdateText(
        [{ type: 'published', day: '2026-10-13' }],
        NOW,
        TZ,
        'en',
      ),
    ).toBe(
      'Outage schedule updated\nSchedule for tomorrow (Tue 13 Oct) published: no outages',
    );
  });

  it('has nothing to say without changes', () => {
    expect(scheduleUpdateText([], NOW, TZ, 'en')).toBeNull();
  });
});
