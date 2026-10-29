/**
 * The outage schedule reader: a native process that checks the grid
 * operator's site for the address set in the app and reports to the server, on its own
 * schedule (see cadence.ts). Runs beside the server, like the BMS reader.
 *
 *   npm run outage-reader             check on schedule, forever
 *   npm run outage-reader -- --once   one check, then exit
 *
 * Settings: OUTAGE_SERVER_URL, OUTAGE_READER_TOKEN, OUTAGE_INTERVAL_MINUTES,
 * OUTAGE_EVENING_INTERVAL_MINUTES, OUTAGE_EVENING, OUTAGE_BLOCKED_HOURS,
 * OUTAGE_BROWSER_EVERY_DAYS, OUTAGE_STATE_FILE, from the environment, then
 * eam_server/.env, then the repository's .env. See README.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFiles } from '../bms-reader/env-files';
import { formatLogLine } from '../serial-logger/log-line';
import { nextCheckAt } from './cadence';
import { outageReaderConfig } from './config';
import { readStreet } from './dnem/read-street';
import { DnemSiteClient } from './dnem/site-client';
import { runCheck, type ReaderState } from './run-check';
import { ReaderServerClient } from './server-client';
import { waitForNextCheck } from './wait';
import { SITE_TIME_ZONE } from './dnem/constants';

const log = (message: string) =>
  console.log(formatLogLine(message, new Date(), 'outage-reader'));
const siteClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: SITE_TIME_ZONE,
  dateStyle: 'short',
  timeStyle: 'short',
});
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function readState(path: string): ReaderState {
  const fresh: ReaderState = { lastBrowserCheckAt: null, streetsHash: null };
  if (!existsSync(path)) return fresh;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      lastBrowserCheckAt:
        typeof parsed.lastBrowserCheckAt === 'string'
          ? parsed.lastBrowserCheckAt
          : null,
      streetsHash:
        typeof parsed.streetsHash === 'string' ? parsed.streetsHash : null,
    };
  } catch {
    log(`Ignoring unreadable state file ${path}`);
    return fresh;
  }
}

function saveState(path: string, state: ReaderState): void {
  try {
    writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`Could not save ${path}: ${message}`);
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const files = loadEnvFiles(
    [join(process.cwd(), '.env'), join(process.cwd(), '..', '.env')],
    process.env,
  );
  const config = outageReaderConfig(process.env);
  log(
    `Settings from ${files.join(', ') || 'the environment'}; reporting to ${config.server.url}`,
  );
  const server = new ReaderServerClient(config.server);
  const deps = {
    server,
    read: (city: string, street: string, options: { forceBrowser: boolean }) =>
      readStreet(
        new DnemSiteClient({ baseUrl: config.siteUrl }),
        city,
        street,
        options,
      ),
    now: () => new Date(),
    browserEveryDays: config.browserEveryDays,
    log,
  };
  let state = readState(config.stateFile);
  for (;;) {
    const started = new Date();
    let blocked = false;
    try {
      const outcome = await runCheck(deps, state);
      state = outcome.state;
      saveState(config.stateFile, state);
      blocked = outcome.result.kind === 'failed' && outcome.result.blocked;
    } catch (e) {
      log(
        `Check stopped by an unexpected error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
      );
    }
    if (once) return;
    const next = nextCheckAt(started, config.cadence, { blocked });
    log(`Next check at ${siteClock.format(next)} (site time)`);
    // Earlier if someone asks for a check in the app.
    await waitForNextCheck(
      { server, now: () => new Date(), sleep, log },
      next,
      {
        blocked,
      },
    );
  }
}

main().catch((e) => {
  console.error(
    formatLogLine(
      e instanceof Error ? e.message : String(e),
      new Date(),
      'outage-reader',
    ),
  );
  process.exit(1);
});
