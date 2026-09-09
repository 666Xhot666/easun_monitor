/**
 * Matches either a dotted IPv4 address or a valid DNS hostname/label
 * (RFC 1123-ish — letters, digits, hyphens, dot-separated labels, no
 * spaces). Used anywhere a user supplies the inverter logger's network
 * address: a bare `@IsIP(4)` would reject legitimate values like
 * `host.docker.internal` (how the mock emulator in scripts/mock-inverter.js
 * is reached from inside Docker) or any other name-resolvable logger —
 * Node's own net.Socket/dgram calls resolve hostnames just fine, so
 * there's no real reason to restrict input to numeric IPv4 only.
 *
 * Deliberately not strict about IPv4 octet ranges (e.g. "999.999.999.999"
 * matches) — this only decides what's *routable to attempt*, not a
 * security boundary; a bogus address just fails to connect at pairing
 * time with a clear error, same as today.
 */
export const HOST_ADDRESS_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export const HOST_ADDRESS_MESSAGE =
  'ipAddress must be a valid IPv4 address or hostname (e.g. 192.168.1.50 or host.docker.internal)';
