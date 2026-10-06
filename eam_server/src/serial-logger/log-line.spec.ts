import { formatLogLine } from './log-line';

describe('formatLogLine', () => {
  const at = new Date('2026-10-05T19:17:03.456Z');

  it('prefixes the message with a local timestamp and the service name', () => {
    expect(formatLogLine('RX open; TX open', at)).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \[serial-logger\] RX open; TX open$/,
    );
  });

  it('names the exact instant, whatever the machine time zone', () => {
    const [date, time] = formatLogLine('x', at).split(' ');
    expect(Date.parse(`${date}T${time}`)).toBe(Date.parse('2026-10-05T19:17:03Z'));
  });
});
