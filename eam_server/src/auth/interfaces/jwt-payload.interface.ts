/** Shape of the payload encoded into every access token this app issues. */
export interface JwtPayload {
  /** Subject — the User's numeric id. */
  sub: number;
  email: string;
}

/**
 * What `JwtStrategy.validate()` returns, and therefore what ends up on
 * `request.user` (and what `@CurrentUser()` reads from). Deliberately not
 * the full Prisma `User` row — the JWT itself is the only thing verified
 * on every request; anything beyond id/email should be re-fetched from the
 * database by the handler that actually needs it, so a revoked/changed
 * account can't act on stale claims baked into an old token.
 */
export interface AuthenticatedUser {
  userId: number;
  email: string;
}
