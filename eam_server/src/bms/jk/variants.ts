/**
 * JK BMS Bluetooth protocol variants, as named by syssi/esphome-jk-bms. The
 * cell-info layout differs between them; the reference takes the variant
 * from configuration rather than detecting it, and so does this app
 * (BMS_PROTOCOL, default JK02_32S).
 */
export const BMS_PROTOCOLS = ['JK02_32S', 'JK02_24S', 'JK04'] as const;
export type BmsProtocol = (typeof BMS_PROTOCOLS)[number];
export const DEFAULT_BMS_PROTOCOL: BmsProtocol = 'JK02_32S';

export function parseBmsProtocol(value: string | undefined): BmsProtocol {
  if (!value) return DEFAULT_BMS_PROTOCOL;
  const match = BMS_PROTOCOLS.find((p) => p === value.trim().toUpperCase());
  if (!match) {
    throw new Error(
      `BMS_PROTOCOL must be one of ${BMS_PROTOCOLS.join(', ')} (got "${value}")`,
    );
  }
  return match;
}
