import {
  HEALTHY_SESSION_MS,
  RECONNECT_FIRST_MS,
  RECONNECT_MAX_MS,
} from './constants';

export interface ReconnectOptions<C> {
  connect: () => Promise<C>;
  /** Runs one connected session; resolves with why it ended. */
  session: (connection: C) => Promise<string>;
  onEvent: (message: string) => void;
  signal: AbortSignal;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Connects, runs a session, and on any error or disconnect tries again after
 * a delay that starts at 1 s and doubles up to 30 s. Never gives up; stops
 * only when `signal` aborts.
 */
export async function reconnectLoop<C>(
  options: ReconnectOptions<C>,
): Promise<void> {
  let delay = RECONNECT_FIRST_MS;
  while (!options.signal.aborted) {
    let reason: string;
    try {
      const connection = await options.connect();
      const startedAt = Date.now();
      reason = await options.session(connection);
      if (Date.now() - startedAt >= HEALTHY_SESSION_MS)
        delay = RECONNECT_FIRST_MS;
    } catch (error) {
      reason = message(error);
    }
    if (options.signal.aborted) return;
    options.onEvent(`${reason}; retrying in ${delay / 1000} s`);
    await sleep(delay, options.signal);
    delay = Math.min(delay * 2, RECONNECT_MAX_MS);
  }
}
