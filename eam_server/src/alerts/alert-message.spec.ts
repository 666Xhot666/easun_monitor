import { scheduleUpdateMessage } from '../outage/notices';
import { reminderMessage } from '../outage/reminders';
import { alertKindOf, alertText, type AlertMessage } from './alert-message';

const ZONE = 'UTC';

describe('alertText', () => {
  it('words an alert in the language asked for', () => {
    const lost = { key: 'gridLost' };
    expect(alertText(lost, 'en', ZONE)).toBe('Grid lost');
    expect(alertText(lost, 'uk', ZONE)).toBe('Мережа зникла');
  });

  it('names faults and warnings by their bit, in the language', () => {
    const fault = { key: 'fault', params: { fault: 3 } };
    expect(alertText(fault, 'en', ZONE)).toBe('Fault: Battery over voltage');
    expect(alertText(fault, 'uk', ZONE)).toBe(
      'Несправність: Перенапруга акумулятора',
    );
    expect(
      alertText({ key: 'warning', params: { warning: 14 } }, 'uk', ZONE),
    ).toBe('Попередження: Вентилятор заблоковано');
  });

  it('gives lengths of time and clock times in the language and zone', () => {
    expect(
      alertText({ key: 'loggerBack', params: { downMs: 420_000 } }, 'uk', ZONE),
    ).toBe('Логер знову на зв’язку, не відповідав 7 хв');
    expect(
      alertText(
        { key: 'loggerDown', params: { sinceAt: '2026-10-11T06:05:00Z' } },
        'en',
        'Europe/London',
      ),
    ).toBe('Logger not answering since 07:05');
  });
});

describe('BMS alarms', () => {
  it('names the alarm in the language', () => {
    const alarm = { key: 'bmsAlarm', params: { alarm: 'Charge overcurrent' } };
    expect(alertText(alarm, 'en', ZONE)).toBe('BMS alarm: Charge overcurrent');
    expect(alertText(alarm, 'uk', ZONE)).toBe('Тривога BMS: Надструм заряду');
  });
});

describe('alertKindOf', () => {
  it('takes the kind from the key', () => {
    expect(alertKindOf('faultsCleared')).toBe('fault');
    expect(alertKindOf('gridRestored')).toBe('grid');
    expect(alertKindOf('batteryLow')).toBe('battery');
    expect(alertKindOf('bmsSilent')).toBe('connection');
    expect(alertKindOf('bmsAlarm')).toBe('warning');
  });
});

describe('outage alerts', () => {
  const kyiv = (local: string) => new Date(`${local}+03:00`);
  /** As stored in the database and read back. */
  const stored = (m: AlertMessage | null) =>
    JSON.parse(JSON.stringify(m)) as AlertMessage;

  it('words a stored schedule update as of when it was made', () => {
    const message = scheduleUpdateMessage(
      [
        {
          type: 'new',
          kind: 'SCHEDULE',
          status: 'OFF',
          start: kyiv('2026-10-13T18:00:00'),
          end: kyiv('2026-10-13T20:00:00'),
          description: null,
        },
      ],
      kyiv('2026-10-12T20:40:00'),
    );
    expect(alertText(stored(message), 'uk', ZONE)).toBe(
      'Графік відключень оновлено\nЗавтра 18:00–20:00 відключення (нове)',
    );
    expect(alertKindOf('scheduleUpdated')).toBe('schedule');
  });

  it('words a stored reminder, with how long the schedule was out', () => {
    const message = reminderMessage(
      {
        start: kyiv('2026-10-12T18:00:00'),
        end: kyiv('2026-10-12T20:00:00'),
        status: 'off',
        source: 'schedule',
        description: null,
      },
      kyiv('2026-10-12T17:45:00'),
      { soc: 64, staleHours: null },
    );
    expect(alertText(stored(message), 'en', ZONE)).toBe(
      'Outage in 15 min: 18:00–20:00\nBattery 64 %',
    );
    expect(
      alertText(
        {
          key: 'scheduleUnavailable',
          params: { forMs: 7_200_000, reason: 'blocked' },
        },
        'uk',
        ZONE,
      ),
    ).toBe(
      'Графік відключень недоступний: жодної вдалої перевірки вже 2 год; сайт заблокував зчитувач',
    );
  });
});
