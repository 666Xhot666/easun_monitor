/**
 * The BMS reader: a native process on the machine within Bluetooth range of
 * the JK BMS (Docker on macOS cannot reach Bluetooth). It reads the BMS,
 * read-only, and posts normalized readings to the server's ingest endpoint,
 * exactly as the ESP32 will later.
 *
 *   npm run bms-reader                     read and deliver, reconnecting forever
 *   npm run bms-reader -- --scan           list nearby Bluetooth peripherals, then exit
 *   npm run bms-reader -- --decode <file>  re-decode a capture's raw frames (BMS_PROTOCOL)
 *
 * Settings (env): BMS_NAME, BMS_ID, BMS_PROTOCOL, BMS_INGEST_URL,
 * BMS_INGEST_TOKEN, BMS_SEND_INTERVAL_MS, DEV_CAPTURE_DIR. See README.
 */
import { CELL_INFO_FRAME, decodeCellInfo } from '../bms/jk/cell-info';
import { DEVICE_INFO_FRAME, decodeDeviceInfo } from '../bms/jk/device-info';
import { formatLogLine } from '../serial-logger/log-line';
import { BmsSession, DECODER_VERSION } from './bms-session';
import { BmsCaptureFile, readCapture } from './capture-file';
import { readerConfig } from './config';
import { IngestClient } from './ingest-client';
import { connectBms, scanPeripherals } from './noble-transport';
import { reconnectLoop } from './reconnect-loop';

const SCAN_MS = 10_000;
/** Readings waiting for the server: about five minutes at the send interval. */
const QUEUE_MINUTES = 5;

const log = (message: string) =>
  console.log(formatLogLine(message, new Date(), 'bms-reader'));

async function scan(): Promise<void> {
  log(`Scanning for ${SCAN_MS / 1000} s...`);
  const seen = await scanPeripherals(SCAN_MS);
  if (seen.length === 0) {
    log(
      'No Bluetooth peripherals found at all. On macOS the likely cause is permission: allow this terminal or IDE under System Settings > Privacy & Security > Bluetooth.',
    );
    return;
  }
  for (const p of seen)
    console.log(
      `${String(p.rssi).padStart(5)} dBm  ${p.id}  ${p.name || '(no name)'}`,
    );
}

function decode(
  path: string,
  protocol: ReturnType<typeof readerConfig>['protocol'],
): void {
  const { header, frames } = readCapture(path);
  log(
    `${path}: captured as ${header.protocol} by ${header.decoderVersion}; decoding as ${protocol} with ${DECODER_VERSION}`,
  );
  for (const frame of frames) {
    try {
      if (frame.frameType === DEVICE_INFO_FRAME)
        console.log(frame.at, JSON.stringify(decodeDeviceInfo(frame.bytes)));
      if (frame.frameType === CELL_INFO_FRAME)
        console.log(
          frame.at,
          JSON.stringify(decodeCellInfo(frame.bytes, protocol)),
        );
    } catch (error) {
      console.log(
        frame.at,
        `decode failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function run(config: ReturnType<typeof readerConfig>): Promise<void> {
  const capture = BmsCaptureFile.create(config.captureDir, {
    startedAt: new Date(),
    protocol: config.protocol,
    decoderVersion: DECODER_VERSION,
  });
  log(`Capturing to ${capture.path}`);

  const ingest = config.ingest
    ? new IngestClient({
        ...config.ingest,
        minIntervalMs: config.sendIntervalMs,
        maxQueue: Math.ceil((QUEUE_MINUTES * 60_000) / config.sendIntervalMs),
        onEvent: (message) => {
          log(message);
          capture.event('ingest', message);
        },
      })
    : null;
  if (!ingest)
    log(
      'BMS_INGEST_URL is not set: reading and capturing only, nothing is sent to the server',
    );

  let lastStatusAt = 0;
  const stop = new AbortController();
  process.on('SIGINT', () => stop.abort());
  process.on('SIGTERM', () => stop.abort());

  await reconnectLoop({
    signal: stop.signal,
    connect: async () => {
      const connection = await connectBms({ name: config.name, id: config.id });
      log(`Connected to ${connection.name || '(no name)'} (${connection.id})`);
      capture.event('connect', `${connection.name} ${connection.id}`);
      return connection;
    },
    session: (connection) =>
      new BmsSession(connection, {
        protocol: config.protocol,
        source: 'mac-ble',
        now: Date.now,
        onReading: (reading) => {
          capture.reading(reading);
          ingest?.offer(reading);
          if (Date.now() - lastStatusAt >= 60_000) {
            lastStatusAt = Date.now();
            log(
              `${reading.packVoltageV} V, ${reading.currentA} A, SOC ${reading.stateOfChargePct}%, cells ${reading.cellMinV}-${reading.cellMaxV} V`,
            );
          }
        },
        onEvent: (event) => {
          if (event.kind === 'frame') {
            capture.frame(event.frameType, event.hex);
            return;
          }
          capture.event(event.kind, event.detail);
          log(`${event.kind}: ${event.detail}`);
        },
      }).run(),
    onEvent: (message) => {
      log(message);
      capture.event('reconnect', message);
    },
  });
  log('Stopped');
}

async function main(): Promise<void> {
  const config = readerConfig(process.env);
  const args = process.argv.slice(2);
  if (args[0] === '--scan') return scan();
  if (args[0] === '--decode') {
    if (!args[1]) throw new Error('Usage: --decode <capture file>');
    return decode(args[1], config.protocol);
  }
  return run(config);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      formatLogLine(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        new Date(),
        'bms-reader',
      ),
    );
    process.exit(1);
  });
