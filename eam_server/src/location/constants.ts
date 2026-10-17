/** Decimals a stored location keeps: 0.1 degree is about 10 km, enough for weather. */
export const LOCATION_DECIMALS = 1;

/**
 * Looks the caller up by its public address: free, no key. Asked from the
 * server, so it finds where the server is, which is where the inverter is.
 */
export const LOCATION_LOOKUP_URL = 'https://ipwho.is/';
export const LOCATION_LOOKUP_TIMEOUT_MS = 5_000;
