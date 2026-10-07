import { Resvg } from '@resvg/resvg-js';
import { escapeHtml } from './cards';

export interface ChartSeries {
  label: string;
  color: string;
  /** Time (ms) and value (W), oldest first. */
  points: { t: number; v: number }[];
}

export interface ChartRange {
  from: number;
  to: number;
  timeZone: string;
  /** Readings further apart than this are not joined by a line. */
  maxGapMs: number;
}

const WIDTH = 800;
const HEIGHT = 450;
const PLOT = { left: 70, right: 780, top: 60, bottom: 410 };
const FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';
const HOUR_MS = 3_600_000;

const watts = (w: number) =>
  Math.abs(w) >= 1000
    ? `${Number((w / 1000).toFixed(1))} kW`
    : `${Math.round(w)} W`;

/** A step of 1, 2 or 5 x 10^n that gives about `count` ticks over `span`. */
function niceStep(span: number, count: number): number {
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((m) => m * power >= raw)!;
  return step * power;
}

/** Splits points into runs with no gap longer than `maxGapMs`. */
function runs(points: ChartSeries['points'], maxGapMs: number) {
  const result: ChartSeries['points'][] = [];
  for (const point of points) {
    const run = result.at(-1);
    if (run && point.t - run.at(-1)!.t <= maxGapMs) run.push(point);
    else result.push([point]);
  }
  return result;
}

/** `attrs` may add attributes, but not repeat these (resvg rejects duplicates). */
const text = (x: number, y: number, content: string, attrs = '', size = 13) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="#374151" ${attrs}>${content}</text>`;

/** A power-over-time line chart as SVG, in watts, with hour ticks in the time zone. */
export function powerChartSvg(
  title: string,
  series: ChartSeries[],
  range: ChartRange,
): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`,
    text(PLOT.left, 30, escapeHtml(title), 'font-weight="bold"', 18),
  ];
  const values = series.flatMap((s) => s.points.map((p) => p.v));
  if (values.length === 0) {
    parts.push(
      text(WIDTH / 2, HEIGHT / 2, 'No readings', 'text-anchor="middle"'),
      '</svg>',
    );
    return parts.join('');
  }

  const step = niceStep(
    Math.max(...values, 0) - Math.min(...values, 0) || 100,
    5,
  );
  const low = Math.floor(Math.min(...values, 0) / step) * step;
  const high = Math.ceil(Math.max(...values, step) / step) * step;
  const x = (t: number) =>
    PLOT.left +
    ((t - range.from) / (range.to - range.from)) * (PLOT.right - PLOT.left);
  const y = (v: number) =>
    PLOT.bottom - ((v - low) / (high - low)) * (PLOT.bottom - PLOT.top);

  for (let v = low; v <= high + step / 2; v += step) {
    const color = Math.abs(v) < step / 2 ? '#9ca3af' : '#e5e7eb';
    parts.push(
      `<line x1="${PLOT.left}" x2="${PLOT.right}" y1="${y(v)}" y2="${y(v)}" stroke="${color}"/>`,
      text(
        PLOT.left - 8,
        y(v) + 4,
        watts(Math.abs(v) < step / 2 ? 0 : v),
        'text-anchor="end"',
      ),
    );
  }

  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: range.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  // Every whole hour in range; label those that fall on 00, 06, 12, 18 local.
  for (
    let t = Math.ceil(range.from / HOUR_MS) * HOUR_MS;
    t <= range.to;
    t += HOUR_MS
  ) {
    const label = hour.format(t);
    if (!['00:00', '06:00', '12:00', '18:00'].includes(label)) continue;
    parts.push(
      `<line x1="${x(t)}" x2="${x(t)}" y1="${PLOT.top}" y2="${PLOT.bottom}" stroke="#e5e7eb"/>`,
      text(x(t), PLOT.bottom + 20, label, 'text-anchor="middle"'),
    );
  }

  series.forEach((s, i) => {
    for (const run of runs(s.points, range.maxGapMs)) {
      const coords = run
        .map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
        .join(' ');
      parts.push(
        `<polyline points="${coords}" fill="none" stroke="${s.color}" stroke-width="2"/>`,
      );
    }
    const lx = PLOT.left + 330 + i * 110;
    parts.push(
      `<rect x="${lx}" y="20" width="14" height="4" fill="${s.color}"/>`,
      text(lx + 20, 27, escapeHtml(s.label)),
    );
  });

  parts.push('</svg>');
  return parts.join('');
}

/** Renders SVG to PNG, with the system fonts (font-dejavu in the Docker image). */
export function svgToPng(svg: string): Buffer {
  return new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
  })
    .render()
    .asPng();
}
