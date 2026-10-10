/**
 * Matching what a check shows against the outage events already known, so
 * that a known outage seen again is the same event (revised if its times
 * changed) rather than a new one, and one that has gone is withdrawn.
 *
 * Shown and known events match when their status is the same and their times
 * overlap; each known event matches at most one shown event.
 */

export type EventStatus = 'OFF' | 'POSSIBLE' | 'UNKNOWN';

export interface IncomingEvent {
  start: Date;
  end: Date;
  status: EventStatus;
  /** The site's description, for a repair on the house. */
  description: string | null;
}

export interface KnownEvent extends IncomingEvent {
  id: number;
}

export interface EventPlan {
  create: IncomingEvent[];
  /** Known events with their new times or description. */
  revise: Array<{ id: number } & IncomingEvent>;
  /** Known events seen again as they were. */
  unchanged: number[];
  /** Known events no longer shown. */
  withdraw: number[];
}

/**
 * `known` must hold only the events the check can speak for (the caller
 * leaves out finished ones and days the site no longer shows).
 */
export function planEvents(
  known: KnownEvent[],
  incoming: IncomingEvent[],
): EventPlan {
  const plan: EventPlan = {
    create: [],
    revise: [],
    unchanged: [],
    withdraw: [],
  };
  const unmatched = [...known].sort(byStart);

  for (const shown of [...incoming].sort(byStart)) {
    const i = unmatched.findIndex(
      (k) =>
        k.status === shown.status && k.start < shown.end && shown.start < k.end,
    );
    if (i === -1) {
      plan.create.push(shown);
      continue;
    }
    const [match] = unmatched.splice(i, 1);
    const same =
      match.start.getTime() === shown.start.getTime() &&
      match.end.getTime() === shown.end.getTime() &&
      match.description === shown.description;
    if (same) plan.unchanged.push(match.id);
    else plan.revise.push({ id: match.id, ...shown });
  }

  plan.withdraw = unmatched.map((k) => k.id);
  return plan;
}

function byStart(a: { start: Date }, b: { start: Date }): number {
  return a.start.getTime() - b.start.getTime();
}
