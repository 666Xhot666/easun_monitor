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

/** Values younger than this are answered from what was last heard. */
export const FRESH_MS = 2000;
/** The app waits 3 s for the logger; a read through the proxy gets at most this. */
export const READ_THROUGH_MS = 2000;
/** A block whose read failed is answered from what was last heard for this long. */
export const FAILED_RETRY_MS = 10_000;
