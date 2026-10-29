import { createHash } from 'node:crypto';
import type { StreetReading } from './dnem/read-street';
import type { DaySlots } from './dnem/schedule-page';
import { SiteError } from './dnem/site-error';
import { runCheck, type CheckDeps, type ReaderState } from './run-check';
import { ServerError, type ReaderSource } from './server-client';

const day = () => Array.from({ length: 24 }, () => 'yes') as DaySlots;
const STREETS = { 'м. Тестове': ['вул. Тестова'] };
const SOURCE: ReaderSource = {
  site: 'dnem',
  city: 'м. Тестове',
  street: 'вул. Тестова',
  house: '12а',
  enabled: true,
};
const NOW = new Date('2026-10-10T17:00:00Z');
const fresh: ReaderState = {
  lastBrowserCheckAt: '2026-10-08T17:00:00.000Z',
  streetsHash: null,
};

const reading = (usedBrowser = false): StreetReading => ({
  usedBrowser,
  page: {
    ajaxUrl: 'x',
    csrfToken: 't',
    streets: STREETS,
    weekly: {
      groupNames: {},
      groups: {
        'GPV5.2': Object.fromEntries(
          [1, 2, 3, 4, 5, 6, 7].map((d) => [d, day()]),
        ),
      },
    },
    confirmed: { today: 0, updated: '10.10.2026 20:40', days: {} },
  },
  houses: { '12а': { groups: ['GPV5.2'], outage: null } },
});

/** Fakes for the server and the site, recording what the check did. */
function setUp(options: {
  source?: ReaderSource | Error;
  read?: Array<StreetReading | Error>;
  postError?: Error;
}) {
  const sent = {
    streets: [] as unknown[],
    checks: [] as Array<Record<string, unknown>>,
  };
  const reads: Array<{ forceBrowser: boolean }> = [];
  const logs: string[] = [];
  const answers = options.read ?? [reading()];
  const deps: CheckDeps = {
    server: {
      source: () =>
        options.source instanceof Error
          ? Promise.reject(options.source)
          : Promise.resolve(options.source ?? SOURCE),
      putStreets: (streets) => {
        sent.streets.push(streets);
        return Promise.resolve();
      },
      postCheck: (check) => {
        sent.checks.push(check as Record<string, unknown>);
        return options.postError
          ? Promise.reject(options.postError)
          : Promise.resolve();
      },
    },
    read: (city, street, opts) => {
      reads.push(opts);
      const answer = answers.shift();
      if (!answer) return Promise.reject(new Error('unexpected read'));
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
    now: () => NOW,
    browserEveryDays: 7,
    log: (m) => logs.push(m),
  };
  return { deps, sent, reads, logs };
}

describe('runCheck', () => {
  it('reads the address the server gives, uploads the streets once, and sends the check', async () => {
    const { deps, sent, reads } = setUp({ read: [reading(), reading()] });
    const first = await runCheck(deps, fresh);

    expect(first.result).toEqual({ kind: 'ok', usedBrowser: false });
    expect(reads).toEqual([{ forceBrowser: false }]);
    expect(sent.streets).toEqual([STREETS]);
    expect(sent.checks).toEqual([
      expect.objectContaining({
        checkedAt: '2026-10-10T17:00:00.000Z',
        outcome: 'ok',
        house: { found: true, groups: ['GPV5.2'], outage: null },
      }),
    ]);
    expect(first.state.streetsHash).toBe(
      createHash('sha256').update(JSON.stringify(STREETS)).digest('hex'),
    );

    await runCheck(deps, first.state);
    expect(sent.streets).toHaveLength(1);
    expect(sent.checks).toHaveLength(2);
  });

  it('does not touch the site when the source is switched off', async () => {
    const { deps, reads, sent } = setUp({
      source: { ...SOURCE, enabled: false },
    });
    expect((await runCheck(deps, fresh)).result).toEqual({ kind: 'skipped' });
    expect(reads).toEqual([]);
    expect(sent.checks).toEqual([]);
  });

  it('does not touch the site when the server cannot be reached', async () => {
    const { deps, reads, logs } = setUp({
      source: new ServerError('Server unreachable: fetch failed', false),
    });
    expect((await runCheck(deps, fresh)).result).toEqual({
      kind: 'server-unreachable',
    });
    expect(reads).toEqual([]);
    expect(logs.join()).toMatch(/unreachable/);
  });

  it('says so when the server refuses the token', async () => {
    const { deps, logs } = setUp({
      source: new ServerError(
        'Server answered 401: Unknown outage reader token',
        true,
      ),
    });
    await runCheck(deps, fresh);
    expect(logs.join()).toMatch(/token/i);
  });

  it('goes through the browser once a week, and remembers when', async () => {
    const { deps, reads } = setUp({ read: [reading(true)] });
    const stale = { ...fresh, lastBrowserCheckAt: '2026-10-03T16:00:00.000Z' };
    const { state, result } = await runCheck(deps, stale);
    expect(reads).toEqual([{ forceBrowser: true }]);
    expect(result).toEqual({ kind: 'ok', usedBrowser: true });
    expect(state.lastBrowserCheckAt).toBe('2026-10-10T17:00:00.000Z');
  });

  it('also goes through the browser on its first run', async () => {
    const { deps, reads } = setUp({ read: [reading(true)] });
    await runCheck(deps, { lastBrowserCheckAt: null, streetsHash: null });
    expect(reads).toEqual([{ forceBrowser: true }]);
  });

  it('falls back to plain requests when the browser itself will not start', async () => {
    const { deps, reads, logs, sent } = setUp({
      read: [new Error('Playwright could not be loaded'), reading()],
    });
    const { result, state } = await runCheck(deps, {
      ...fresh,
      lastBrowserCheckAt: null,
    });
    expect(reads).toEqual([{ forceBrowser: true }, { forceBrowser: false }]);
    expect(result).toEqual({ kind: 'ok', usedBrowser: false });
    expect(state.lastBrowserCheckAt).toBeNull();
    expect(logs.join()).toMatch(/Playwright/);
    expect(sent.checks).toHaveLength(1);
  });

  it('reports a failed check to the server, blocked when even the browser was turned away', async () => {
    const { deps, sent } = setUp({
      read: [
        new SiteError(
          'challenge',
          'The site answered with a firewall challenge',
        ),
      ],
    });
    const { result } = await runCheck(deps, fresh);
    expect(result).toEqual({
      kind: 'failed',
      error: 'challenge',
      blocked: true,
    });
    expect(sent.checks).toEqual([
      {
        checkedAt: '2026-10-10T17:00:00.000Z',
        outcome: 'challenge',
        usedBrowser: true,
        error: 'The site answered with a firewall challenge',
      },
    ]);
  });

  it('is not blocked by a site that is simply down', async () => {
    const { deps, sent } = setUp({
      read: [new SiteError('server', 'The site answered HTTP 502')],
    });
    const { result } = await runCheck(deps, fresh);
    expect(result).toEqual({ kind: 'failed', error: 'server', blocked: false });
    expect(sent.checks[0]).toMatchObject({
      outcome: 'server',
      usedBrowser: false,
    });
  });

  it('keeps going when the check cannot be delivered', async () => {
    const { deps, logs } = setUp({
      postError: new ServerError('Server unreachable: fetch failed', false),
    });
    const { result } = await runCheck(deps, fresh);
    expect(result).toEqual({ kind: 'server-unreachable' });
    expect(logs.join()).toMatch(/not delivered/);
  });
});
