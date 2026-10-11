import { ServerError, type ReaderServerClient } from './server-client';

export interface WaitDeps {
  server: Pick<ReaderServerClient, 'source'>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

/**
 * Waits until `until`, asking the server every minute whether someone asked
 * for a check in the app: 'refresh' if so, 'due' when the time has come.
 * While blocked by the site, such requests wait for the next check.
 */
export async function waitForNextCheck(
  deps: WaitDeps,
  until: Date,
  options: { blocked: boolean; pollMs?: number },
): Promise<'due' | 'refresh'> {
  const pollMs = options.pollMs ?? 60_000;
  for (;;) {
    const remaining = until.getTime() - deps.now().getTime();
    if (remaining <= 0) return 'due';
    await deps.sleep(Math.min(pollMs, remaining));
    if (deps.now() >= until) return 'due';
    if (options.blocked) continue;
    try {
      const source = await deps.server.source();
      if (source.enabled && source.refresh) {
        deps.log('A check was asked for in the app');
        return 'refresh';
      }
    } catch (e) {
      // The next check reports an unreachable server; keep waiting.
      if (!(e instanceof ServerError)) throw e;
    }
  }
}
