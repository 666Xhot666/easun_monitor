import {
  fitWiringDrop,
  inverterReading,
  type VoltagePair,
} from './wiring-drop';

/** An inverter that reads 0.23 V low, behind 12.5 mΩ of cable. */
const pair = (currentA: number, batteryV = 26, noiseV = 0): VoltagePair => ({
  bmsVoltageV: batteryV,
  bmsCurrentA: currentA,
  inverterVoltageV: batteryV - 0.23 + 0.0125 * currentA + noiseV,
  inverterCurrentA: currentA,
});

describe('fitWiringDrop', () => {
  it('finds the path resistance and the inverter offset from both directions', () => {
    const pairs = [-76, -45, -33, -14, -6, 5, 13, 23, 34, 42].map((a) =>
      pair(a),
    );
    const fit = fitWiringDrop(pairs);
    expect(fit?.resistanceOhm).toBeCloseTo(0.0125, 4);
    expect(fit?.offsetV).toBeCloseTo(-0.23, 3);
    expect(fit?.samples).toBe(10);
  });

  it('tells how much lower the inverter reads than the battery at a current', () => {
    const fit = fitWiringDrop([-76, -6, 5, 42].map((a) => pair(a)))!;
    // Discharging at 75 A: 0.23 V offset + 75 A × 12.5 mΩ.
    expect(inverterReading(fit, 25.1, -75)).toBeCloseTo(25.1 - 1.1675, 3);
  });

  it('leaves out pairs whose currents disagree: the two were not read at the same moment', () => {
    const good = [-76, -30, -6, 5, 20, 42].map((a) => pair(a));
    const stepped = {
      ...pair(-15),
      inverterCurrentA: -75,
      inverterVoltageV: 23.9,
    };
    const opposite = { ...pair(30), inverterCurrentA: -2 };
    const fit = fitWiringDrop([...good, stepped, opposite]);
    expect(fit?.samples).toBe(6);
    expect(fit?.resistanceOhm).toBeCloseTo(0.0125, 4);
  });

  it('gives nothing until the currents spread enough to tell resistance from offset', () => {
    expect(fitWiringDrop([])).toBeNull();
    expect(fitWiringDrop([-8, -6, -5, 4, 6].map((a) => pair(a)))).toBeNull();
  });

  it('copes with the inverter reading in 0.1 V steps', () => {
    const steps = [-76, -60, -45, -33, -14, -6, 5, 13, 23, 34, 42].flatMap(
      (a, i) => [pair(a, 26, ((i % 3) - 1) * 0.05), pair(a, 25.5)],
    );
    const fit = fitWiringDrop(
      steps.map((p) => ({
        ...p,
        inverterVoltageV: Math.round(p.inverterVoltageV * 10) / 10,
      })),
    );
    expect(fit!.resistanceOhm * 1000).toBeGreaterThan(11.5);
    expect(fit!.resistanceOhm * 1000).toBeLessThan(13.5);
    expect(Math.abs(fit!.offsetV + 0.23)).toBeLessThan(0.05);
  });
});
