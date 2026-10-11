import type { SchedulePage } from './schedule-page';
import {
  retrying,
  type DnemSiteClient,
  type HouseInfo,
  type RetryOptions,
} from './site-client';
import { SiteError } from './site-error';

export interface StreetReading {
  page: SchedulePage;
  houses: Record<string, HouseInfo>;
  /** Whether the check had to go through the browser. */
  usedBrowser: boolean;
}

/**
 * One check of a street: the schedule page and the street's houses. Plain
 * requests first; if the site answers with its firewall check or refuses
 * them, the whole check is done again in a browser. `forceBrowser` goes there
 * directly (the weekly check that keeps the browser path proven). Failures of
 * the site itself are retried, never sent to the browser. The browser is
 * always closed afterwards.
 */
export async function readStreet(
  client: DnemSiteClient,
  city: string,
  street: string,
  options: { forceBrowser?: boolean; retry?: RetryOptions } = {},
): Promise<StreetReading> {
  const { forceBrowser = false, retry } = options;
  try {
    let block: SiteError | null = null;
    if (!forceBrowser) {
      try {
        const page = await retrying(() => client.loadPage(), retry);
        const houses = await retrying(() => client.houses(city, street), retry);
        return { page, houses, usedBrowser: false };
      } catch (e) {
        if (!needsBrowser(e)) throw e;
        block = e;
      }
    }
    const page = await retrying(
      () => client.loadPage({ browser: true }),
      retry,
    ).catch((e: unknown) => {
      // A browser that cannot start leaves the site's block standing.
      if (!block || e instanceof SiteError) throw e;
      throw new SiteError(
        block.kind,
        `${block.message}; the browser could not start: ${(e as Error).message}`,
      );
    });
    const houses = await retrying(() => client.houses(city, street), retry);
    return { page, houses, usedBrowser: true };
  } finally {
    await client.close();
  }
}

function needsBrowser(e: unknown): e is SiteError {
  return (
    e instanceof SiteError && (e.kind === 'challenge' || e.kind === 'rejected')
  );
}
