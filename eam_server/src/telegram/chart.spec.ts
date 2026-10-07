import { powerChartSvg, svgToPng, type ChartSeries } from './chart';

const FROM = Date.parse('2026-10-06T00:00:00Z');
const TO = FROM + 24 * 3_600_000;
const at = (hours: number) => FROM + hours * 3_600_000;

const pv: ChartSeries = {
  label: 'PV',
  color: '#f59e0b',
  points: [
    { t: at(8), v: 200 },
    { t: at(8.25), v: 900 },
    { t: at(12), v: 1500 },
    { t: at(12.25), v: 1400 },
  ],
};
const load: ChartSeries = {
  label: 'Load <home>',
  color: '#3b82f6',
  points: [
    { t: at(1), v: -300 },
    { t: at(1.25), v: 350 },
  ],
};

describe('powerChartSvg', () => {
  const svg = powerChartSvg('Garage & co', [pv, load], {
    from: FROM,
    to: TO,
    timeZone: 'UTC',
    maxGapMs: 30 * 60_000,
  });

  it('has an escaped title and legend', () => {
    expect(svg).toContain('Garage &amp; co');
    expect(svg).toContain('Load &lt;home&gt;');
  });

  it('breaks a line where readings are missing for longer than the gap', () => {
    // PV: 08:00-08:15 and 12:00-12:15 are separate runs; load is one run.
    expect(svg.match(/<polyline /g)).toHaveLength(3);
  });

  it('labels the hours in the time zone and the watts, including below zero', () => {
    for (const hour of ['00:00', '06:00', '12:00', '18:00'])
      expect(svg).toContain(`>${hour}<`);
    expect(svg).toContain('>0 W<');
    expect(svg).toMatch(/>-\d+ W</);
    expect(svg).toMatch(/>1\.5 kW<|>2 kW</);
  });

  it('says when there is nothing to draw', () => {
    expect(
      powerChartSvg('Home', [], {
        from: FROM,
        to: TO,
        timeZone: 'UTC',
        maxGapMs: 1,
      }),
    ).toContain('No readings');
  });
});

describe('svgToPng', () => {
  it('renders a PNG', () => {
    const png = svgToPng(
      powerChartSvg('Home', [pv], {
        from: FROM,
        to: TO,
        timeZone: 'UTC',
        maxGapMs: 30 * 60_000,
      }),
    );
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
