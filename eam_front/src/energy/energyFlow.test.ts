import { describe, expect, it } from 'vitest';
import { computeEnergyFlow, formatPower } from './energyFlow';

describe('formatPower', () => {
  it('shows whole watts below 1 kW', () => {
    expect(formatPower(0)).toBe('0W');
    expect(formatPower(278)).toBe('278W');
    expect(formatPower(999.6)).toBe('1000W');
  });

  it('shows kW with one decimal above 1000 W', () => {
    expect(formatPower(1200)).toBe('1.2kW');
    expect(formatPower(3456)).toBe('3.5kW');
  });

  it('shows the magnitude: direction is drawn, not written', () => {
    expect(formatPower(-310)).toBe('310W');
  });

  it('shows "--" when there is no value', () => {
    expect(formatPower(undefined)).toBe('--');
    expect(formatPower(Number.NaN)).toBe('--');
  });
});

/** The reference screenshot: night, grid up but unused, battery carrying the house. */
const NIGHT_ON_BATTERY = {
  PVPower: 0,
  MainsVoltage: 231.4,
  AverageMainsPower: 0,
  BatterySoc: 88,
  BatteryVoltage: 26.5,
  BatteryCurrentSigned: -11.7,
  OutputActivePower: 278,
};

describe('computeEnergyFlow', () => {
  it('matches the reference screenshot', () => {
    const flow = computeEnergyFlow(NIGHT_ON_BATTERY);

    expect(flow.pv).toMatchObject({ value: '0W', active: false, available: false });
    expect(flow.grid).toMatchObject({ value: '0W', active: false, available: true });
    expect(flow.battery).toMatchObject({
      value: '88%',
      active: true,
      available: true,
      direction: 'toInverter',
    });
    expect(flow.load).toMatchObject({
      value: '278W',
      active: true,
      available: true,
      direction: 'fromInverter',
    });
  });
});
