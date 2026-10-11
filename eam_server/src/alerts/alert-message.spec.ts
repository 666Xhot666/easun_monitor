import { alertKindOf, alertText } from './alert-message';

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

describe('alertKindOf', () => {
  it('takes the kind from the key', () => {
    expect(alertKindOf('faultsCleared')).toBe('fault');
    expect(alertKindOf('gridRestored')).toBe('grid');
    expect(alertKindOf('batteryLow')).toBe('battery');
    expect(alertKindOf('bmsSilent')).toBe('connection');
    expect(alertKindOf('bmsAlarm')).toBe('warning');
  });
});
