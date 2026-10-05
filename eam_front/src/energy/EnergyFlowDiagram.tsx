import { BatteryMedium, Cpu, House, SolarPanel, UtilityPole, type LucideIcon } from 'lucide-react';
import type { EnergyFlow } from './energyFlow';

interface NodeLayout {
  key: keyof EnergyFlow;
  label: string;
  Icon: LucideIcon;
  /** Icon centre. */
  cx: number;
  cy: number;
  /** Drawn from the node to the inverter: vertical, rounded corner, horizontal. */
  path: string;
  /** Value text: halfway between the corner and the inverter. */
  vx: number;
  vy: number;
  /** Label beside the icon, on the side away from the line. */
  lx: number;
  ly: number;
  anchor: 'start' | 'end';
}

const NODES: readonly NodeLayout[] = [
  {
    key: 'pv', label: 'PV', Icon: SolarPanel, cx: 60, cy: 40,
    path: 'M60,64 V128 Q60,140 72,140 H170', vx: 115, vy: 132, lx: 96, ly: 44, anchor: 'start',
  },
  {
    key: 'grid', label: 'Grid', Icon: UtilityPole, cx: 340, cy: 40,
    path: 'M340,64 V128 Q340,140 328,140 H230', vx: 285, vy: 132, lx: 304, ly: 44, anchor: 'end',
  },
  {
    key: 'battery', label: 'Battery', Icon: BatteryMedium, cx: 60, cy: 260,
    path: 'M60,236 V172 Q60,160 72,160 H170', vx: 115, vy: 176, lx: 96, ly: 264, anchor: 'start',
  },
  {
    key: 'load', label: 'Load', Icon: House, cx: 340, cy: 260,
    path: 'M340,236 V172 Q340,160 328,160 H230', vx: 285, vy: 176, lx: 304, ly: 264, anchor: 'end',
  },
];

const ICON_SIZE = 28;

/** Where power is flowing between PV, grid, battery, house and the inverter. */
export default function EnergyFlowDiagram({ flow }: { flow: EnergyFlow }) {
  return (
    <svg viewBox="0 0 400 300" role="img" aria-label="Energy flow" className="block h-auto w-full">
      <style>{`
        .flow-dots {
          stroke: #E8C468; stroke-width: 4; stroke-linecap: round; fill: none;
          stroke-dasharray: 0 14; animation: flow-dash 1s linear infinite;
        }
        .flow-dots[data-direction="fromInverter"] { animation-direction: reverse; }
        @keyframes flow-dash { to { stroke-dashoffset: -14; } }
        @media (prefers-reduced-motion: reduce) { .flow-dots { animation: none; } }
      `}</style>
      <defs>
        <radialGradient id="flow-platform">
          <stop offset="0%" stopColor="#4A9EFF" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#4A9EFF" stopOpacity="0" />
        </radialGradient>
        <filter id="flow-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="400" height="300" rx="16" fill="#232C34" />

      {NODES.map(({ key, path }) => {
        const connection = flow[key];
        return (
          <g
            key={key}
            data-testid={`flow-line-${key}`}
            data-active={String(connection.active)}
            data-direction={connection.direction}
          >
            <path d={path} stroke="#4A5866" strokeWidth="3" fill="none" strokeLinecap="round" />
            {connection.active && (
              <path d={path} className="flow-dots" data-direction={connection.direction} />
            )}
          </g>
        );
      })}

      <rect x="170" y="118" width="60" height="64" rx="10" fill="#2E3A45" stroke="#4A5866" />
      <Cpu x={186} y={128} width={ICON_SIZE} height={ICON_SIZE} color="#E6EDF3" strokeWidth={1.75} />
      <text x="200" y="172" textAnchor="middle" fontSize="11" fill="#C9D1D9">
        Device
      </text>

      {NODES.map(({ key, label, Icon, cx, cy, vx, vy, lx, ly, anchor }) => {
        const connection = flow[key];
        return (
          <g key={key}>
            <g
              data-testid={`flow-node-${key}`}
              data-available={String(connection.available)}
              opacity={connection.available ? 1 : 0.35}
            >
              <ellipse cx={cx} cy={cy + 14} rx="26" ry="9" fill="url(#flow-platform)" />
              <Icon
                x={cx - ICON_SIZE / 2}
                y={cy - ICON_SIZE / 2}
                width={ICON_SIZE}
                height={ICON_SIZE}
                color="#E6EDF3"
                strokeWidth={1.75}
                filter={connection.available ? 'url(#flow-glow)' : undefined}
              />
            </g>
            <text x={lx} y={ly} textAnchor={anchor} fontSize="13" fill="#C9D1D9">
              {label}
            </text>
            <text
              data-testid={`flow-value-${key}`}
              data-active={String(connection.active)}
              x={vx}
              y={vy}
              textAnchor="middle"
              fontSize="13"
              fontWeight="600"
              fill={connection.active ? '#4A9EFF' : '#FFFFFF'}
            >
              {connection.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
