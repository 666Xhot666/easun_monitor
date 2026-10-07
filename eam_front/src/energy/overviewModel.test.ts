import { describe, expect, it } from 'vitest';
import { batteryEta, formatDuration, sceneValues, statusSentence } from './overviewModel';

describe('statusSentence', () => {
  it('says what powers the home, what the battery does and whether the grid is there', () => {
    expect(statusSentence({ pvW: 2840, gridW: 0, batteryW: 1580, gridAvailable: true })).toBe(
      'On solar · battery charging 1.58 kW · grid available',
    );
  });

  it('names the grid when the home draws from it', () => {
    expect(statusSentence({ pvW: 0, gridW: 900, batteryW: 0, gridAvailable: true })).toBe('On grid · battery idle · grid available');
  });

  it('names the battery when it carries the home alone', () => {
    expect(statusSentence({ pvW: 0, gridW: 0, batteryW: -620, gridAvailable: false })).toBe(
      'On battery · battery discharging 620 W · grid down',
    );
  });

  it('says solar and battery when both feed the home', () => {
    expect(statusSentence({ pvW: 400, gridW: 0, batteryW: -300, gridAvailable: true })).toBe(
      'On solar and battery · battery discharging 300 W · grid available',
    );
  });

  it('leaves out what it does not know', () => {
    expect(statusSentence({ pvW: undefined, gridW: undefined, batteryW: undefined, gridAvailable: undefined })).toBe('No data yet');
  });
});

describe('batteryEta', () => {
  it('says how long until full while charging', () => {
    expect(batteryEta({ currentA: 31.2, remainingCapacityAh: 144, nominalCapacityAh: 200 })).toEqual({ kind: 'full', hours: 56 / 31.2 });
  });

  it('says how long until empty while discharging', () => {
    expect(batteryEta({ currentA: -20, remainingCapacityAh: 100, nominalCapacityAh: 200 })).toEqual({ kind: 'empty', hours: 5 });
  });

  it('says nothing while idle or when the BMS lacks a value', () => {
    expect(batteryEta({ currentA: 0.2, remainingCapacityAh: 100, nominalCapacityAh: 200 })).toBeNull();
    expect(batteryEta({ currentA: 10, remainingCapacityAh: null, nominalCapacityAh: 200 })).toBeNull();
  });
});

describe('formatDuration', () => {
  it('shows hours and minutes', () => {
    expect(formatDuration(2 + 10 / 60)).toBe('2 h 10 m');
    expect(formatDuration(0.75)).toBe('45 m');
    expect(formatDuration(30)).toBe('30 h');
  });
});

describe('sceneValues', () => {
  const payload = { PVPower: 2840, AverageMainsPower: 0, OutputActivePower: 1260, MainsVoltage: 231, BatteryCurrentSigned: 30, BatteryVoltage: 52.7, BatterySoc: 70 };

  it('takes the battery from the inverter when there is no live BMS', () => {
    const v = sceneValues(payload, { pvRatedW: 6600 });
    expect(v.pv).toEqual({ value: '2.84 kW', sub: '43% of array' });
    expect(v.load).toEqual({ value: '1.26 kW', sub: 'From solar' });
    expect(v.grid).toEqual({ value: '0 W', sub: 'On standby' });
    expect(v.battery).toEqual({ value: '1.58 kW', sub: '70% · charging' });
    expect(v.watts).toEqual({ pv: 2840, grid: 0, load: 1260, battery: 1581 });
    expect(v.sentence).toBe('On solar · battery charging 1.58 kW · grid available');
  });

  it('prefers a live BMS for the battery, with the time to full', () => {
    const v = sceneValues(payload, {
      bms: { stateOfChargePct: 72, powerW: 1662, currentA: 31.2, remainingCapacityAh: 144, nominalCapacityAh: 200 },
    });
    expect(v.battery).toEqual({ value: '1.66 kW', sub: '72% · charging', extra: 'Full in 1 h 48 m' });
    expect(v.pv.sub).toBe('Array not set up');
  });

  it('says where the home draws from when the grid carries it', () => {
    const v = sceneValues({ ...payload, PVPower: 0, AverageMainsPower: 900, BatteryCurrentSigned: 0 }, {});
    expect(v.load.sub).toBe('From grid');
    expect(v.grid.sub).toBe('Importing');
  });

  it('shows dashes for what the reading lacks', () => {
    const v = sceneValues({}, {});
    expect(v.pv.value).toBe('--');
    expect(v.battery).toEqual({ value: '--', sub: '--' });
    expect(v.grid.sub).toBe('Not available');
  });
});
