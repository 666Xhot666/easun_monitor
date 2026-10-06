import { describe, expect, it } from 'vitest';
import { checkArray, computeArray, utilization, type PanelType } from './pvArray';

const longi: PanelType = { id: 1, name: 'Longi 450W', maxPowerW: 450, vmpV: 41.5, impA: 10.85, vocV: 49.5, iscA: 11.5 };

describe('computeArray', () => {
  it('adds voltages along a string and currents across strings', () => {
    expect(computeArray(longi, { inSeries: 3, strings: 2 })).toEqual({
      panels: 6,
      powerW: 2700,
      vmpV: 124.5,
      vocV: 148.5,
      impA: 21.7,
      iscA: 23,
    });
  });
});

describe('checkArray', () => {
  const array = computeArray(longi, { inSeries: 3, strings: 2 }); // Voc 148.5, Vmp 124.5, Isc 23, 2700 W

  it('has nothing to say when the array fits every limit that is set', () => {
    expect(checkArray(array, { maxVocV: 500, mpptMinV: 60, mpptMaxV: 450, maxPowerW: 4000, maxCurrentA: 27 })).toEqual([]);
    expect(checkArray(array, {})).toEqual([]);
  });

  it('warns when the open-circuit voltage is above the maximum, or close enough to pass it in cold weather', () => {
    expect(checkArray(array, { maxVocV: 140 })).toEqual([
      { level: 'danger', message: 'Open-circuit voltage 148.5 V is above the inverter maximum of 140 V and can damage it.' },
    ]);
    expect(checkArray(array, { maxVocV: 160 })).toEqual([
      { level: 'warning', message: 'Open-circuit voltage 148.5 V is within 15% of the 160 V maximum; it rises on cold mornings.' },
    ]);
  });

  it('warns when the working voltage is outside the MPPT range', () => {
    expect(checkArray(array, { mpptMinV: 130 })[0].message).toBe(
      'Working voltage 124.5 V is below the MPPT range (from 130 V): the inverter cannot track the array well.',
    );
    expect(checkArray(array, { mpptMaxV: 120 })[0].message).toBe(
      'Working voltage 124.5 V is above the MPPT range (up to 120 V).',
    );
  });

  it('notes power above the PV input rating, and current above the input limit', () => {
    expect(checkArray(array, { maxPowerW: 2000 })).toEqual([
      { level: 'info', message: 'Array power 2700 W is above the 2000 W PV input rating; the inverter caps what it takes.' },
    ]);
    expect(checkArray(array, { maxCurrentA: 20 })).toEqual([
      { level: 'warning', message: 'Short-circuit current 23 A is above the 20 A PV input limit.' },
    ]);
  });
});

describe('utilization', () => {
  it("is PV power as a share of the array's rated power", () => {
    expect(utilization(1350, 2700)).toBe(50);
    expect(utilization(0, 2700)).toBe(0);
    expect(utilization(undefined, 2700)).toBeUndefined();
    expect(utilization(100, undefined)).toBeUndefined();
  });
});
