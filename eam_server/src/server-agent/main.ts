/**
 * The server agent: a native process reporting the host it runs on (CPU,
 * memory, disks, network, temperatures, fans, services, containers) to the
 * server once a cycle. Runs beside the server, like the BMS reader.
 *
 *   npm run server-agent             report every cycle, forever
 *   npm run server-agent -- --once   one report, then exit
 *
 * Settings: SERVER_AGENT_URL, SERVER_AGENT_TOKEN,
 * SERVER_AGENT_INTERVAL_SECONDS, SERVER_AGENT_SERVICES, from the environment,
 * then eam_server/.env, then the repository's .env. See README.
 */
import { join } from 'node:path';
import { loadEnvFiles } from '../bms-reader/env-files';
import { formatLogLine } from '../serial-logger/log-line';
import { Collector } from './collect';
import { serverAgentConfig } from './config';
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
  const collector = new Collector({ services: config.services });
  // A failed report is logged once, until reports go through again.
  let failing = false;
  for (;;) {
    const started = Date.now();
    try {
      await server.postSample(await collector.sample(new Date()));
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
    if (once) return;
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
