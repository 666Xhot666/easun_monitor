import {
  planEvents,
  type IncomingEvent,
  type KnownEvent,
} from './event-matching';

const at = (hhmm: string) => new Date(`2026-10-10T${hhmm}:00Z`);
const seen = (
  start: string,
  end: string,
  status: IncomingEvent['status'] = 'OFF',
): IncomingEvent => ({
  start: at(start),
  end: at(end),
  status,
  description: null,
});
const known = (
  id: number,
  start: string,
  end: string,
  status: KnownEvent['status'] = 'OFF',
): KnownEvent => ({
  id,
  ...seen(start, end, status),
});

describe('planEvents', () => {
  it('creates what is not known yet', () => {
    expect(planEvents([], [seen('15:00', '19:00')])).toEqual({
      create: [seen('15:00', '19:00')],
      revise: [],
      unchanged: [],
      withdraw: [],
    });
  });

  it('recognises a known event seen again unchanged', () => {
    expect(
      planEvents([known(1, '15:00', '19:00')], [seen('15:00', '19:00')]),
    ).toEqual({
      create: [],
      revise: [],
      unchanged: [1],
      withdraw: [],
    });
  });

  it('revises a known event whose times moved, as long as they overlap', () => {
    const plan = planEvents(
      [known(1, '15:00', '19:00')],
      [seen('15:00', '22:55')],
    );
    expect(plan.revise).toEqual([{ id: 1, ...seen('15:00', '22:55') }]);
    expect(plan.create).toEqual([]);
  });

  it('withdraws a known event that is no longer shown', () => {
    expect(planEvents([known(1, '15:00', '19:00')], [])).toEqual({
      create: [],
      revise: [],
      unchanged: [],
      withdraw: [1],
    });
  });

  it('treats times that do not overlap as a different event', () => {
    const plan = planEvents(
      [known(1, '10:00', '12:00')],
      [seen('15:00', '19:00')],
    );
    expect(plan.create).toEqual([seen('15:00', '19:00')]);
    expect(plan.withdraw).toEqual([1]);
  });

  it('does not match a possible outage with a definite one', () => {
    const plan = planEvents(
      [known(1, '15:00', '19:00', 'POSSIBLE')],
      [seen('15:00', '19:00', 'OFF')],
    );
    expect(plan.create).toHaveLength(1);
    expect(plan.withdraw).toEqual([1]);
  });

  it('keeps one known event for one shown event when it splits in two', () => {
    const plan = planEvents(
      [known(1, '15:00', '19:00')],
      [seen('15:00', '16:00'), seen('18:00', '19:00')],
    );
    expect(plan.revise).toEqual([{ id: 1, ...seen('15:00', '16:00') }]);
    expect(plan.create).toEqual([seen('18:00', '19:00')]);
  });

  it('withdraws the extra known event when two merge into one', () => {
    const plan = planEvents(
      [known(1, '15:00', '16:00'), known(2, '17:00', '19:00')],
      [seen('15:00', '19:00')],
    );
    expect(plan.revise).toEqual([{ id: 1, ...seen('15:00', '19:00') }]);
    expect(plan.withdraw).toEqual([2]);
  });

  it('revises a description that changed', () => {
    const plan = planEvents(
      [{ ...known(1, '15:00', '19:00'), description: 'Планові роботи' }],
      [{ ...seen('15:00', '19:00'), description: 'Аварійні ремонтні роботи' }],
    );
    expect(plan.revise).toEqual([
      {
        id: 1,
        ...seen('15:00', '19:00'),
        description: 'Аварійні ремонтні роботи',
      },
    ]);
  });
});
