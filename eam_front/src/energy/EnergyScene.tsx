import type { ReactNode } from 'react';
import { House, Sun, UtilityPole, BatteryMedium, type LucideIcon } from 'lucide-react';
import dayPhoto from '../assets/scene/house-day.jpg';
import nightPhoto from '../assets/scene/house-night.jpg';
import type { SystemState } from '../shell/systemState';

/** Watts below this count as idle: no line, no animation. */
const DEADBAND_W = 10;

/** Cable routes on the 1024 × 572 photo, from the source to where it ends. */
const ROUTES = {
  grid: [[78, 186], [78, 350], [344, 350], [344, 288], [413, 288]],
  pv: [[470, 120], [470, 150], [462, 150], [462, 262], [450, 262]],
  battery: [[432, 302], [432, 376]],
  load: [[450, 283], [648, 283], [648, 230]],
} as const;
type Line = keyof typeof ROUTES;

const LINE_COLOUR: Record<Line, string> = {
  grid: 'oklch(0.72 0.15 245)',
  pv: 'oklch(0.85 0.15 85)',
  battery: 'oklch(0.7 0.2 315)',
  load: 'oklch(0.8 0.2 145)',
};
const DOT_HUE: Record<Line, number> = { grid: 245, pv: 85, battery: 315, load: 145 };
const IDLE_GREY = 'oklch(0.8 0.005 80)';

/** A polyline with rounded corners. */
function roundedPath(points: readonly (readonly [number, number])[], radius = 12): string {
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i];
    const next = points[i + 1];
    if (!next) {
      d += ` L${px},${py}`;
      break;
    }
    const [qx, qy] = points[i - 1];
    const l1 = Math.hypot(px - qx, py - qy);
    const l2 = Math.hypot(next[0] - px, next[1] - py);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const ax = px - ((px - qx) / l1) * r;
    const ay = py - ((py - qy) / l1) * r;
    const bx = px + ((next[0] - px) / l2) * r;
    const by = py + ((next[1] - py) / l2) * r;
    d += ` L${ax.toFixed(1)},${ay.toFixed(1)} Q${px},${py} ${bx.toFixed(1)},${by.toFixed(1)}`;
  }
  return d;
}

export interface SceneNode {
  /** "2.84 kW" */
  value: string;
  /** "43% of array" */
  sub: string;
  /** Battery only: "Full in 2 h 10 m". */
  extra?: string;
}

export interface SceneProps {
  /** Absolute watts per line; battery is signed (+ charging). */
  watts: { pv?: number; grid?: number; battery?: number; load?: number };
  pv: SceneNode;
  grid: SceneNode;
  battery: SceneNode;
  load: SceneNode;
  /** The inverter's operating mode, e.g. "Off-grid". */
  mode: string;
  systemState: SystemState;
  /** "Last reading 2 min ago", shown while stale or offline. */
  staleNote?: string;
  /** Defaults to the clock: night from 19:00 to 06:00. */
  night?: boolean;
}

function Label({
  style,
  colour,
  name,
  node,
  active,
}: {
  style: React.CSSProperties;
  colour: string;
  name: string;
  node: SceneNode;
  active: boolean;
}) {
  return (
    <div
      style={style}
      className="pointer-events-none absolute hidden flex-col gap-px rounded-[0.6em] border border-black/10 bg-white/95 px-[0.8em] pt-[0.45em] pb-[0.5em] leading-tight whitespace-nowrap text-[oklch(0.22_0.01_80)] @[560px]:flex"
    >
      <span className="flex items-center gap-[0.45em] opacity-80">
        <span className="h-[0.6em] w-[0.6em] rounded-full" style={{ background: colour, opacity: active ? 1 : 0.45 }} />
        {name}
      </span>
      <span className="text-[1.35em] font-semibold tabular-nums">{node.value}</span>
      {node.sub && <span className="text-[0.85em] opacity-75">{node.sub}</span>}
      {node.extra && <span className="text-[0.85em] opacity-75">{node.extra}</span>}
    </div>
  );
}

function Tile({ Icon, colour, name, node }: { Icon: LucideIcon; colour: string; name: string; node: SceneNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] bg-surface-2 p-3">
      <span className="grid h-10 w-10 flex-none place-items-center rounded-full border-2" style={{ borderColor: colour, color: colour }}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-xs text-muted">{name}</span>
        <span className="text-[17px] font-semibold tabular-nums">{node.value}</span>
        <span className="truncate text-xs text-muted">{node.extra ?? node.sub}</span>
      </span>
    </div>
  );
}

/** Where power flows, drawn on a photo of a house; tiles replace the labels on narrow screens. */
export default function EnergyScene({ watts, pv, grid, battery, load, mode, systemState, staleNote, night }: SceneProps) {
  const hour = new Date().getHours();
  const isNight = night ?? (hour < 6 || hour >= 19);
  const dimmed = systemState === 'stale' || systemState === 'offline';
  const animate = systemState === 'live';
  const lineWatts: Record<Line, number> = {
    pv: Math.abs(watts.pv ?? 0),
    grid: Math.abs(watts.grid ?? 0),
    battery: Math.abs(watts.battery ?? 0),
    load: Math.abs(watts.load ?? 0),
  };
  const filter = dimmed
    ? 'grayscale(0.9) brightness(0.72) contrast(0.9)'
    : systemState === 'fault'
      ? 'grayscale(0.5) brightness(0.6)'
      : undefined;

  const lines: ReactNode[] = [];
  for (const line of Object.keys(ROUTES) as Line[]) {
    const on = lineWatts[line] > DEADBAND_W;
    const d = roundedPath(ROUTES[line]);
    const colour = dimmed ? IDLE_GREY : LINE_COLOUR[line];
    if (!on) {
      lines.push(<path key={line} d={d} fill="none" stroke="oklch(0.85 0 0 / 0.22)" strokeWidth={3} strokeLinecap="round" />);
      continue;
    }
    const seconds = Math.max(0.6, 2.4 - lineWatts[line] / 1500).toFixed(2);
    const reverse = line === 'battery' && (watts.battery ?? 0) < 0;
    lines.push(
      <g key={line} data-testid={`scene-line-${line}`} data-active="true">
        <path d={d} fill="none" stroke={colour} strokeWidth={20} strokeOpacity={0.35} strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'blur(6px)' }} />
        <path d={d} fill="none" stroke={colour} strokeWidth={10} strokeOpacity={0.55} strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} fill="none" stroke={colour} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
        <path
          d={d}
          fill="none"
          stroke={dimmed ? 'oklch(0.92 0 0 / 0.7)' : `oklch(0.98 0.04 ${DOT_HUE[line]})`}
          strokeWidth={6.5}
          strokeLinecap="round"
          strokeDasharray="0.1 20"
          style={{
            animation: animate ? `eam-flow-dash ${seconds}s linear infinite${reverse ? ' reverse' : ''}` : 'none',
          }}
        />
      </g>,
    );
  }

  const active = (w: number) => w > DEADBAND_W;
  return (
    <div className="@container">
      <div className="relative aspect-[1024/572] w-full overflow-hidden rounded-[10px] bg-[oklch(0.2_0.03_260)] text-[clamp(11px,1.75cqw,14px)]">
        <img
          src={isNight ? nightPhoto : dayPhoto}
          alt="House with solar panels, grid connection, inverter and battery"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ filter }}
        />
        <svg viewBox="0 0 1024 572" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          {lines}
        </svg>
        {staleNote && dimmed && (
          <div className="absolute top-[4%] left-[2.5%] flex items-center gap-1.5 rounded-full border border-black/10 bg-white/95 px-2.5 py-1 font-medium whitespace-nowrap text-[oklch(0.22_0.01_80)]">
            <span className="h-[7px] w-[7px] rounded-full bg-warn" />
            {staleNote}
          </div>
        )}
        <Label style={{ left: '63.48%', top: '10.84%' }} colour="var(--pv)" name="Solar" node={pv} active={active(lineWatts.pv)} />
        <Label style={{ left: '68.36%', top: '31.12%' }} colour="var(--good)" name="Home" node={load} active={active(lineWatts.load)} />
        <Label style={{ right: '60.45%', bottom: '54.2%' }} colour="var(--muted)" name="Inverter" node={{ value: mode, sub: '' }} active />
        <Label style={{ left: '2.5%', bottom: '3%' }} colour="var(--grid)" name="Grid" node={grid} active={active(lineWatts.grid)} />
        <Label style={{ left: '47.27%', bottom: '3%' }} colour="var(--batt)" name="Battery" node={battery} active={active(lineWatts.battery)} />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 @[560px]:hidden">
        <Tile Icon={Sun} colour="var(--pv)" name="Solar" node={pv} />
        <Tile Icon={UtilityPole} colour="var(--grid)" name="Grid" node={grid} />
        <Tile Icon={House} colour="var(--good)" name="Home" node={load} />
        <Tile Icon={BatteryMedium} colour="var(--batt)" name="Battery" node={battery} />
      </div>
    </div>
  );
}
