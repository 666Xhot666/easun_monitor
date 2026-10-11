import { ServerError, type ReaderSource } from './server-client';
import { waitForNextCheck } from './wait';

const SOURCE: ReaderSource = {
  site: 'dnem',
  city: 'м. Дніпро',
  street: 'вул. Тестова',
  house: '12а',
  enabled: true,
  refresh: false,
};

/** A clock that sleeping moves on, and a server answering in turn. */
function setUp(answers: Array<Partial<ReaderSource> | Error>) {
  let now = Date.parse('2026-10-12T10:00:00Z');
  const asked: number[] = [];
  const logs: string[] = [];
  const deps = {
    now: () => new Date(now),
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
    server: {
      source: () => {
        asked.push(now);
        const answer = answers.shift() ?? {};
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve({ ...SOURCE, ...answer });
      },
    },
    log: (m: string) => logs.push(m),
  };
  const at = (minutes: number) => new Date(now + minutes * 60_000);
  return { deps, asked, logs, at, elapsed: () => now };
}

describe('waitForNextCheck', () => {
  it('waits until the next check, asking the server every minute', async () => {
    const { deps, asked, at } = setUp([]);
    const until = at(3.5);
    expect(await waitForNextCheck(deps, until, { blocked: false })).toBe('due');
    expect(deps.now()).toEqual(until);
    expect(asked).toHaveLength(3);
  });

  it('stops early when someone asked for a check in the app', async () => {
    const { deps, at, logs } = setUp([{}, { refresh: true }]);
    const start = deps.now().getTime();
    expect(await waitForNextCheck(deps, at(120), { blocked: false })).toBe(
      'refresh',
    );
    expect(deps.now().getTime() - start).toBe(2 * 60_000);
    expect(logs.join()).toMatch(/asked for in the app/);
  });

  it('ignores the request while switched off or blocked', async () => {
    const off = setUp([{ refresh: true, enabled: false }]);
    expect(
      await waitForNextCheck(off.deps, off.at(1.5), { blocked: false }),
    ).toBe('due');
    expect(off.asked).toHaveLength(1);

    const blocked = setUp([]);
    expect(
      await waitForNextCheck(blocked.deps, blocked.at(5), { blocked: true }),
    ).toBe('due');
    expect(blocked.asked).toEqual([]);
  });

  it('keeps waiting when the server cannot be reached', async () => {
    const { deps, at } = setUp([
      new ServerError('Server unreachable: fetch failed', false),
      { refresh: true },
    ]);
    expect(await waitForNextCheck(deps, at(10), { blocked: false })).toBe(
      'refresh',
    );
  });
});
