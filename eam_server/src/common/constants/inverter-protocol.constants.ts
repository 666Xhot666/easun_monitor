/**
 * Wire-protocol constants for the EASUN ISOLAR SMX-II's "Wi-Fi Plug Pro"
 * adapter (reverse-engineered UDP discovery + a proprietary framing
 * wrapping a real Modbus RTU "read holding registers" frame).
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

/**
 * Transaction id for the 6-byte MBAP-style wrapper header. Fixed rather
 * than per-request because requests are always sent sequentially and
 * awaited one at a time (see InverterService.sendAndReceive) — there's
 * never more than one in flight, so nothing needs it to vary.
 */
export const TRANSACTION_ID = 0xaaaa;

/** Protocol id for the wrapper header (Modbus convention: always 0x0001). */
export const PROTOCOL_ID = 0x0001;

/** Unit id the outer wrapper frame addresses. */
export const OUTER_UNIT_ID = 0xff;

/** Function code for the outer wrapper frame (proprietary, not standard Modbus). */
export const OUTER_FUNCTION_CODE = 0x04;

/** Unit id for the inner, real Modbus RTU frame. */
export const INNER_UNIT_ID = 0xff;

/** Modbus function code 0x03 = "Read Holding Registers". */
export const INNER_FUNCTION_CODE = 0x03;
