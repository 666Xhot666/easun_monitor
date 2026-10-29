export const REFRESH_TOKEN_COOKIE = 'refresh_token';
// Scoped to /api/auth so the browser only ever attaches this cookie to
// the handful of routes that actually read it, instead of sending it
// alongside every other API request.
export const REFRESH_TOKEN_COOKIE_PATH = '/api/auth';

// Cost factor for bcrypt hashing — 12 is comfortably above the commonly
// recommended floor (10) without making login noticeably slow on modest
// hardware (this runs on a small home server/NAS, not scaled infra).
export const BCRYPT_SALT_ROUNDS = 12;

// Refresh tokens are opaque random values, not JWTs — there's nothing to
// decode or verify offline, so the only way to use one is to look its
// hash up in the database. That's what makes rotation and revocation
// possible at all; a self-verifying JWT refresh token could never be
// un-issued early (logout, a stolen-token report, etc).
export const REFRESH_TOKEN_BYTES = 32;
export const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;
