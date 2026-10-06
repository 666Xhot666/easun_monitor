import { describe, expect, it } from 'vitest';
import { computeEnergyFlow, dotDurationS, formatPower } from './energyFlow';

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

  it('reverses the battery dots when it switches to charging', () => {
    const flow = computeEnergyFlow({ ...NIGHT_ON_BATTERY, BatteryCurrentSigned: 11.7 });

    expect(flow.battery).toMatchObject({ active: true, direction: 'fromInverter' });
  });

  it('keeps lines idle inside the deadband so noise does not flicker', () => {
    const flow = computeEnergyFlow({
      ...NIGHT_ON_BATTERY,
      PVPower: 8,
      AverageMainsPower: -6,
      BatteryCurrentSigned: 0.3,
      OutputActivePower: 10,
    });

    expect(flow.pv.active).toBe(false);
    expect(flow.grid.active).toBe(false);
    expect(flow.battery.active).toBe(false);
    expect(flow.load.active).toBe(false);
    expect(flow.pv.value).toBe('8W');
  });

  it('takes the deadband as an option', () => {
    const flow = computeEnergyFlow({ ...NIGHT_ON_BATTERY, OutputActivePower: 40 }, { deadbandW: 50 });

    expect(flow.load.active).toBe(false);
  });

  it('runs PV and grid into the inverter while they supply power', () => {
    const flow = computeEnergyFlow({ ...NIGHT_ON_BATTERY, PVPower: 1450, AverageMainsPower: 600 });

    expect(flow.pv).toMatchObject({ value: '1.4kW', active: true, available: true, direction: 'toInverter' });
    expect(flow.grid).toMatchObject({ value: '600W', active: true, direction: 'toInverter' });
  });

  it("adds PV utilization of the array's rating while PV produces", () => {
    expect(computeEnergyFlow({ ...NIGHT_ON_BATTERY, PVPower: 1404 }, { pvRatedW: 2700 }).pv.value).toBe('1.4kW · 52%');
    expect(computeEnergyFlow(NIGHT_ON_BATTERY, { pvRatedW: 2700 }).pv.value).toBe('0W');
    expect(computeEnergyFlow({ ...NIGHT_ON_BATTERY, PVPower: 1404 }).pv.value).toBe('1.4kW');
  });

  it("uses the BMS's charge and power for the battery when given, and says so", () => {
    const discharging = computeEnergyFlow(NIGHT_ON_BATTERY, { bms: { stateOfChargePct: 91, powerW: -305 } });
    expect(discharging.battery).toMatchObject({
      value: '91%',
      active: true,
      direction: 'toInverter',
      source: 'bms',
      watts: 305,
    });

    const charging = computeEnergyFlow(NIGHT_ON_BATTERY, { bms: { stateOfChargePct: 40, powerW: 520 } });
    expect(charging.battery).toMatchObject({ value: '40%', direction: 'fromInverter', source: 'bms' });

    const idle = computeEnergyFlow(NIGHT_ON_BATTERY, { bms: { stateOfChargePct: 100, powerW: 4 } });
    expect(idle.battery.active).toBe(false);

    expect(computeEnergyFlow(NIGHT_ON_BATTERY).battery.source).toBe('inverter');
  });

  it('dims the grid when mains is down', () => {
    expect(computeEnergyFlow({ ...NIGHT_ON_BATTERY, MainsVoltage: 0 }).grid.available).toBe(false);
  });

  it('shows "--" for a missing field on that connection only', () => {
    const payload: Record<string, number> = { ...NIGHT_ON_BATTERY };
    delete payload.PVPower;
    delete payload.BatterySoc;
    const flow = computeEnergyFlow(payload);

    expect(flow.pv).toMatchObject({ value: '--', active: false });
    expect(flow.battery.value).toBe('--');
    expect(flow.grid.value).toBe('0W');
    expect(flow.load).toMatchObject({ value: '278W', active: true });
  });

  it('idles every line with "--" when there is no reading', () => {
    const flow = computeEnergyFlow(null);

    for (const connection of [flow.pv, flow.grid, flow.battery, flow.load]) {
      expect(connection).toMatchObject({ value: '--', active: false });
    }
  });
});

describe('dotDurationS', () => {
  it('runs the dots faster the more power flows, within limits', () => {
    expect(dotDurationS(100)).toBeLessThan(dotDurationS(20));
    expect(dotDurationS(3000)).toBeLessThan(dotDurationS(300));
    expect(dotDurationS(1_000_000)).toBe(0.4);
    expect(dotDurationS(undefined)).toBe(2.5);
  });
});
