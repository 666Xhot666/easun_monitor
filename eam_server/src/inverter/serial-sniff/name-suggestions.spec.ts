import { RegisterMap } from '../registers/register-map';
import { SMG_II_REGISTERS } from '../registers/smg-ii.registers';
import type { CaptureRecord } from './capture-summary';
import type { GroundTruthSnapshot } from './ground-truth-store';
import { suggestNames } from './name-suggestions';

const map = new RegisterMap(SMG_II_REGISTERS);
const SNAPSHOT_AT = Date.parse('2026-10-03T21:04:18+03:00');
const snapshot: GroundTruthSnapshot = {
  id: 'cloud',
  capturedAt: '2026-10-03T21:04:18+03:00',
  fields: {
    inverter: 3900,
    batteryVoltageV: 27.4,
    gridFrequencyHz: 49.96,
    outputVoltageSettingV: 220.0,
    pvCurrentA: 0,
    batteryCurrentA: 0,
    operatingMode: 'Mains Mode',
  },
};

let seq = 0;
const read = (address: number, words: number[], at: number): CaptureRecord => ({
  seq: ++seq,
  kind: 'pair',
  requestAt: at - 40,
  responseAt: at,
  request: { unit: 1, func: 3, address, quantity: words.length, hex: '' },
  response: { unit: 1, func: 3, byteCount: words.length * 2, words, hex: '' },
});

describe('suggestNames', () => {
  it('suggests a reference field whose value an unknown address matches at some scale', () => {
    const [suggestion] = suggestNames(map, [read(745, [3900], SNAPSHOT_AT - 252_000)], snapshot);
    expect(suggestion).toEqual({
      address: 745,
      raw: 3900,
      at: SNAPSHOT_AT - 252_000,
      gapMs: 252_000,
      matches: [{ field: 'inverter', value: 3900, scale: 1, exact: true, digits: 2, stable: true }],
    });
  });

  it('tries the scales the register map uses, and marks fast-changing fields', () => {
    const [battery, frequency, setting] = suggestNames(
      map,
      [read(500, [274, 4996, 2200], SNAPSHOT_AT)],
      snapshot,
    );
    expect(battery.matches).toEqual([{ field: 'batteryVoltageV', value: 27.4, scale: 0.1, exact: true, digits: 3, stable: false }]);
    expect(frequency.matches).toEqual([expect.objectContaining({ field: 'gridFrequencyHz', scale: 0.01, exact: true })]);
    expect(setting.matches).toEqual([expect.objectContaining({ field: 'outputVoltageSettingV', scale: 0.1, stable: true })]);
  });

  it('accepts values within the precision the reference shows, ranked below exact ones', () => {
    const [near] = suggestNames(map, [read(500, [2741], SNAPSHOT_AT)], snapshot);
    expect(near.matches).toEqual([expect.objectContaining({ field: 'batteryVoltageV', scale: 0.01, exact: false })]);
  });

  it('ranks exact over close, stable over fast-changing, then more matching digits', () => {
    // A close stable field with fewer digits still outranks a close fast-changing one with more.
    const fields = { a_PowerW: 27, b_setting: 27, c_setting: 27.43, d_VoltageV: 27.4 };
    const [suggestion] = suggestNames(map, [read(500, [2743], SNAPSHOT_AT)], { ...snapshot, fields });
    expect(suggestion.matches.map((m) => m.field)).toEqual(['c_setting', 'b_setting', 'd_VoltageV', 'a_PowerW']);
  });

  it('collapses a zero, which would match every idle field, into a count', () => {
    const [zero] = suggestNames(map, [read(501, [0], SNAPSHOT_AT)], snapshot);
    expect(zero).toMatchObject({ address: 501, raw: 0, matches: [], zeroMatches: 2 });
  });

  it('uses the value seen closest to the reference time', () => {
    const [suggestion] = suggestNames(
      map,
      [read(745, [3900], SNAPSHOT_AT + 60_000), read(745, [3800], SNAPSHOT_AT + 3_600_000)],
      snapshot,
    );
    expect(suggestion).toMatchObject({ raw: 3900, gapMs: -60_000 });
  });

  it('only suggests names for addresses the register map does not know', () => {
    expect(suggestNames(map, [read(301, [2], SNAPSHOT_AT)], snapshot)).toEqual([]);
  });
});
