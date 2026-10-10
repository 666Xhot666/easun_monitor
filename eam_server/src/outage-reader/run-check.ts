import { createHash } from 'node:crypto';
import { buildCheck } from './build-check';
import type { StreetReading } from './dnem/read-street';
import { SiteError, type SiteErrorKind } from './dnem/site-error';
import { ServerError, type ReaderServerClient } from './server-client';

/** What the reader keeps between checks (and across restarts, in a file). */
export interface ReaderState {
  /** When a check last went through the browser; null before the first. */
  lastBrowserCheckAt: string | null;
  /** sha256 of the street list last uploaded. */
  streetsHash: string | null;
}

export interface CheckDeps {
  server: Pick<ReaderServerClient, 'source' | 'putStreets' | 'postCheck'>;
  read: (
    city: string,
    street: string,
    options: { forceBrowser: boolean },
  ) => Promise<StreetReading>;
  now: () => Date;
  /** How often a check deliberately goes through the browser. */
  browserEveryDays: number;
  log: (message: string) => void;
}

export type CheckResult =
  | { kind: 'ok'; usedBrowser: boolean }
  /** `blocked`: turned away even in the browser, so the next check waits long. */
  | { kind: 'failed'; error: SiteErrorKind; blocked: boolean }
  | { kind: 'skipped' }
  | { kind: 'server-unreachable' };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One check: ask the server which address to check, read the site, upload the
 * street list if it changed, and send the result, or the kind of failure.
 */
export async function runCheck(
  deps: CheckDeps,
  state: ReaderState,
): Promise<{ result: CheckResult; state: ReaderState }> {
  const { server, log } = deps;
  let source;
  try {
    source = await server.source();
  } catch (e) {
    if (!(e instanceof ServerError)) throw e;
    log(
      e.unauthorized
        ? `The server refused the reader token; set OUTAGE_READER_TOKEN from the app (${e.message})`
        : e.message,
    );
    return { result: { kind: 'server-unreachable' }, state };
  }
  if (!source.enabled) {
    log('The outage schedule is switched off in the app; not checking');
    return { result: { kind: 'skipped' }, state };
  }

  const checkedAt = deps.now();
  const due =
    state.lastBrowserCheckAt === null ||
    checkedAt.getTime() - Date.parse(state.lastBrowserCheckAt) >=
      deps.browserEveryDays * DAY_MS;

  let reading: StreetReading;
  try {
    reading = await readWithFallback(deps, source.city, source.street, due);
  } catch (e) {
    if (!(e instanceof SiteError)) throw e;
    const usedBrowser = due || e.kind === 'challenge' || e.kind === 'rejected';
    const delivered = await deliver(deps, {
      checkedAt: checkedAt.toISOString(),
      outcome: e.kind,
      usedBrowser,
      error: e.message,
    });
    log(`Check failed (${e.kind}): ${e.message}`);
    if (!delivered) return { result: { kind: 'server-unreachable' }, state };
    const blocked =
      usedBrowser && (e.kind === 'challenge' || e.kind === 'rejected');
    return { result: { kind: 'failed', error: e.kind, blocked }, state };
  }

  const next = { ...state };
  if (reading.usedBrowser) next.lastBrowserCheckAt = checkedAt.toISOString();

  const streetsHash = createHash('sha256')
    .update(JSON.stringify(reading.page.streets))
    .digest('hex');
  if (streetsHash !== state.streetsHash) {
    try {
      await server.putStreets(reading.page.streets);
      next.streetsHash = streetsHash;
    } catch (e) {
      if (!(e instanceof ServerError)) throw e;
      log(`Street list not delivered: ${e.message}`);
    }
  }

  const check = buildCheck(reading, source.house, checkedAt);
  if (!(await deliver(deps, check))) {
    return { result: { kind: 'server-unreachable' }, state: next };
  }
  const house = check.house.found
    ? `groups ${check.house.groups.join(', ') || 'none'}`
    : 'house not found on the street';
  log(`Checked${reading.usedBrowser ? ' (browser)' : ''}: ${house}`);
  return {
    result: { kind: 'ok', usedBrowser: reading.usedBrowser },
    state: next,
  };
}

/**
 * The weekly browser check must not stop the schedule: if the browser cannot
 * start at all (not installed, broken), the check is made with plain requests.
 */
async function readWithFallback(
  deps: CheckDeps,
  city: string,
  street: string,
  forceBrowser: boolean,
): Promise<StreetReading> {
  try {
    return await deps.read(city, street, { forceBrowser });
  } catch (e) {
    if (!forceBrowser || e instanceof SiteError) throw e;
    deps.log(`The browser check could not run: ${(e as Error).message}`);
    return deps.read(city, street, { forceBrowser: false });
  }
}

async function deliver(deps: CheckDeps, check: object): Promise<boolean> {
  try {
    await deps.server.postCheck(check);
    return true;
  } catch (e) {
    if (!(e instanceof ServerError)) throw e;
    deps.log(`Check not delivered: ${e.message}`);
    return false;
  }
}
