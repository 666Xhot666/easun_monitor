import { createHash, randomBytes } from 'node:crypto';

/**
 * A BMS device's ingest token: 32 random bytes, base64url. Stored only as a
 * sha256 hash (a hash of a 256-bit random value needs no slow hashing, as
 * with refresh tokens); the token itself is shown to the user once.
 */
export function newIngestToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashIngestToken(token) };
}

export function hashIngestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
