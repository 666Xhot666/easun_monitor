/**
 * The server agent: a native process reporting the host it runs on (CPU,
 * memory, disks, network, temperatures, fans, batteries, and the services
 * and containers with what each takes) to the server once a cycle. Runs
 * beside the server, like the BMS reader.
 *
 *   npm run server-agent             report every cycle, forever
 *   npm run server-agent -- --once   one report, then exit
 *
 * With SERVER_AGENT_FAN set, it also runs that fan as the owner set it in the
 * app (handed back to the firmware when the agent stops).
 *
 * Settings: SERVER_AGENT_URL, SERVER_AGENT_TOKEN,
 * SERVER_AGENT_INTERVAL_SECONDS, SERVER_AGENT_SERVICES, SERVER_AGENT_FAN,
 * SERVER_AGENT_FAN_STEPS, SERVER_AGENT_UPDATES_HOURS, from the environment,
 * then eam_server/.env, then the repository's .env. See README.
 */
import { join } from 'node:path';
import { loadEnvFiles } from '../bms-reader/env-files';
import { formatLogLine } from '../serial-logger/log-line';
import { Collector } from './collect';
import { DISK_EVERY_MS } from './constants';
import { serverAgentConfig } from './config';
import type { FanSettings } from './fan/fan-control';
import { FanController, type FanControlState } from './fan/fan-controller';
import { FanDevice } from './fan/fan-device';
import { AgentServerClient, ServerError } from './server-client';

const log = (message: string) =>
  console.log(formatLogLine(message, new Date(), 'server-agent'));
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const files = loadEnvFiles(
    [join(process.cwd(), '.env'), join(process.cwd(), '..', '.env')],
    process.env,
  );
  const config = serverAgentConfig(process.env);
  log(
    `Settings from ${files.join(', ') || 'the environment'}; reporting to ${config.server.url} every ${config.intervalSeconds} s`,
  );
  const server = new AgentServerClient(config.server);
  const collector = new Collector({
    services: config.services,
    updatesEveryMs: config.updatesEveryHours * 60 * 60_000,
    diskEveryMs: DISK_EVERY_MS,
  });
  const fanDevice = config.fan ? FanDevice.find('/', config.fan.name) : null;
  if (config.fan && !fanDevice) {
    log(
      `No fan device called ${config.fan.name} with a pwm1; not controlling the fan`,
    );
  }
  const fan = new FanController(fanDevice, config.fan?.steps ?? null);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      fan.release();
      process.exit(0);
    });
  }
  /** The last settings the server sent; kept while it cannot be reached. */
  let fanSettings: FanSettings | null = null;
  let fanState: FanControlState | null = null;
  // A failed report is logged once, until reports go through again.
  let failing = false;
  for (;;) {
    const started = Date.now();
    const sample = await collector.sample(new Date());
    sample.fanControl = fanState;
    try {
      const answer = (await server.postSample(sample)) as {
        fan?: FanSettings;
      } | null;
      fanSettings = answer?.fan ?? fanSettings;
      if (failing) log('Reports go through again');
      failing = false;
    } catch (e) {
      if (!(e instanceof ServerError)) throw e;
      if (!failing) {
        log(
          e.unauthorized
            ? `The server refused the agent token; set SERVER_AGENT_TOKEN from the app (${e.message})`
            : `Report not delivered: ${e.message}`,
        );
      }
      failing = true;
    }
    const hottest = sample.temperatures.length
      ? Math.max(...sample.temperatures.map((t) => t.celsius))
      : null;
    const previous = fanState;
    fanState = fan.apply(fanSettings, hottest);
    if (fanState?.error && fanState.error !== previous?.error) {
      log(`Could not set the fan: ${fanState.error}`);
    }
    if (once) {
      fan.release();
      return;
    }
    await sleep(
      Math.max(0, started + config.intervalSeconds * 1000 - Date.now()),
    );
  }
}

main().catch((e) => {
  console.error(
    formatLogLine(
      e instanceof Error ? (e.stack ?? e.message) : String(e),
      new Date(),
      'server-agent',
    ),
  );
  process.exit(1);
});
