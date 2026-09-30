/**
 * Wire-protocol constants for the EASUN ISOLAR SMG-II's "Wi-Fi Plug Pro"
 * adapter's UDP discovery handshake.
 *
 * These are NOT deployment configuration — every device of this exact
 * model speaks the identical protocol, so there is no valid alternate
 * value and nothing here belongs in `.env`. Contrast with `INVERTER_IP`,
 * `INVERTER_PORT`, `INVERTER_TIMEOUT_MS`, and `POLLING_INTERVAL_MS`
 * (read via `ConfigService` in InverterService/PollingService), which
 * genuinely differ between installs and must come from the environment.
 *
 * Changing any value below doesn't "configure" anything — it makes the
 * app speak a protocol the device's firmware won't recognize, so each one
 * is commented with what it actually is.
 */

/** UDP port the adapter listens on for the discovery handshake. */
export const UDP_DISCOVERY_PORT = 58899;

/**
 * Placeholder host the adapter tolerates in the handshake message when we
 * can't determine our own local IPv4 address — matches what the vendor's
 * own mobile app sends in that situation.
 */
export const UDP_HANDSHAKE_FALLBACK_HOST = 'PHONE_WIFI_IP';

/** Exact reply payload that confirms the UDP handshake succeeded. */
export const UDP_HANDSHAKE_EXPECTED_REPLY = 'rsp>server=1;';

// Frame-level constants (header ids, unit ids, function codes) live with the
// codec that uses them: ../../inverter/protocol/logger-frame.ts.
