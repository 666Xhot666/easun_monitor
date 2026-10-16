/** USB speed of the ESP proxy (esp_proxy/src/board.h). */
export const ESP_BAUD = 460800;
/** Our read gets no answer from the proxy for this long: given up. The proxy
 * itself says "# timeout" after 1 s without the inverter's reply. */
export const ESP_REQUEST_TIMEOUT_MS = 3000;
/** Reopening the ESP's port after it fails: 1 s doubling to 30 s. */
export const ESP_RETRY_INITIAL_MS = 1000;
export const ESP_RETRY_MAX_MS = 30_000;
/** Modbus unit of the inverter. */
export const INVERTER_UNIT = 1;

/** A block the app reads is read again once its values are this old. */
export const REFRESH_MS = 5000;
/** A block the app has not asked for in this long is no longer read. */
export const WANTED_FOR_MS = 10 * 60_000;
/** A block whose read failed waits this long before the next try. */
export const FAILED_RETRY_MS = 10_000;
/** How often the poller looks for a block to read. */
export const POLL_TICK_MS = 200;
