import { join } from 'node:path';
import { parseBmsProtocol, type BmsProtocol } from '../bms/jk/variants';

export interface ReaderConfig {
  /** Advertised-name prefix of the BMS (BMS_NAME). */
  name: string;
  /** macOS peripheral id (a per-machine UUID, not a MAC), when known (BMS_ID). */
  id: string | null;
  protocol: BmsProtocol;
  /** Where readings go; null runs the reader capture-only (first run, Part E). */
  ingest: { url: string; token: string } | null;
  /** At most one reading per this interval is sent to the server. */
  sendIntervalMs: number;
  /** Capture files (dev tooling): DEV_CAPTURE_DIR/bms. */
  captureDir: string;
}

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function readerConfig(
  env: Record<string, string | undefined>,
): ReaderConfig {
  const url = env.BMS_INGEST_URL?.trim();
  const token = env.BMS_INGEST_TOKEN?.trim();
  if (url && !token) {
    throw new Error(
      'BMS_INGEST_TOKEN is required with BMS_INGEST_URL: create the BMS in the app to get one',
    );
  }
  return {
    name: env.BMS_NAME?.trim() || 'JK-',
    id: env.BMS_ID?.trim() || null,
    protocol: parseBmsProtocol(env.BMS_PROTOCOL),
    ingest: url && token ? { url, token } : null,
    sendIntervalMs: positiveInt(env.BMS_SEND_INTERVAL_MS, 5_000),
    captureDir: join(env.DEV_CAPTURE_DIR || '.dev-captures', 'bms'),
  };
}
