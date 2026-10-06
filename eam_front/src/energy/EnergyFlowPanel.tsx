import type { LatestReading } from '../inverter/types';
import EnergyFlowDiagram from './EnergyFlowDiagram';
import { computeEnergyFlow } from './energyFlow';
import { flowFreshness, formatAge } from './freshness';

interface Props {
  reading: LatestReading | null;
  /** How often new readings are expected; stale after three missed. */
  pollMs: number;
  /** The solar array's rated power, when set up; shows PV utilization. */
  pvRatedW?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/** The energy flow diagram for the latest Reading. */
export default function EnergyFlowPanel({ reading, pollMs, pvRatedW, now = Date.now }: Props) {
  const nowMs = now();
  const freshness = flowFreshness(reading?.timestamp, nowMs, 3 * pollMs);
  const age = reading ? formatAge(nowMs - Date.parse(reading.timestamp)) : undefined;
  return (
    <section aria-label="Energy flow" className="mx-auto max-w-xl">
      <EnergyFlowDiagram flow={computeEnergyFlow(reading?.payload ?? null, { pvRatedW })} freshness={freshness} age={age} />
    </section>
  );
}
