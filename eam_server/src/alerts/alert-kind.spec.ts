import { alertKind } from './alert-kind';

describe('alertKind', () => {
  it.each([
    ['Fault: Battery under-voltage', 'fault'],
    ['Faults cleared', 'fault'],
    ['Warning: Mains waveform abnormal', 'warning'],
    ['BMS alarm: Cell overvoltage', 'warning'],
    ['BMS alarms cleared', 'warning'],
    ['Grid lost', 'grid'],
    ['Grid restored', 'grid'],
    ['Battery low: 18 %', 'battery'],
    ['Logger not answering since 14:28', 'connection'],
    ['Logger back online after 7 min', 'connection'],
    ['BMS reader silent since 03:10', 'connection'],
    ['BMS reader back online after 2 min', 'connection'],
    ['Outage schedule updated', 'schedule'],
    ['Outage in 15 min: 18:00–20:00', 'outage'],
    ['Possible outage in 15 min: 18:00–20:00', 'outage'],
    [
      'Outage schedule unavailable: no successful check for 12 h',
      'schedule-unavailable',
    ],
    ['Outage schedule back after 14 h', 'schedule-unavailable'],
  ])('files "%s" under %s', (message, kind) => {
    expect(alertKind(message)).toBe(kind);
  });

  it('files anything new under warning rather than dropping it', () => {
    expect(alertKind('Something else happened')).toBe('warning');
  });
});
