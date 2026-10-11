/**
 * Why a request to the DTEK site failed:
 * - `challenge`: the firewall answered with its check instead of the page;
 * - `rejected`: the site refused the request (a 4xx, or `result: false`);
 * - `shape`: the answer is not in the expected form (the site changed);
 * - `server`: the site is failing or busy (5xx, 429);
 * - `network`: no answer at all (connection error, timeout).
 */
export type SiteErrorKind =
  'challenge' | 'rejected' | 'shape' | 'server' | 'network';

export class SiteError extends Error {
  constructor(
    readonly kind: SiteErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SiteError';
  }
}
