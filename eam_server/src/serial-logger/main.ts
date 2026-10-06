/**
 * The serial logger service: run on the machine wired to the Wi-Fi logger's
 * TTL pads (two USB-serial taps), it answers the main app as if it were the
 * Wi-Fi logger itself, with the values the real logger last read from the
 * inverter. Pair it in the setup wizard at this machine's address (from
 * Docker: host.docker.internal), port 8899. Read-only; nothing is written to
 * the taps or the inverter.
 *
 *   SERIAL_RX_PORT=/dev/cu.usbserial-A SERIAL_TX_PORT=/dev/cu.usbserial-B npm run serial-logger
 */
import { startLoggerServer } from '../inverter/link/logger-server';
import { CaptureStore } from '../inverter/serial-sniff/capture-store';
import type { PortStatus } from '../inverter/serial-sniff/serial-capture';
import { openSerialTap } from '../inverter/serial-sniff/serial-port-tap';
import { formatLogLine } from './log-line';
import { createSerialLogger } from './serial-logger';

const formatPort = (status: PortStatus, name: string): string => {
  let text = `${name} ${status.state}`;
  if (status.error !== null) {
    text += ` (${status.error})`;
  }
  if (status.reconnects > 0) {
    text += `, ${status.reconnects} reconnects`;
  }
  return text;
};

const main = async (): Promise<void> => {
  const env = process.env;
  const rxPath = env.SERIAL_RX_PORT;
  const txPath = env.SERIAL_TX_PORT;

  if (!rxPath || !txPath) {
    console.error(formatLogLine('Set SERIAL_RX_PORT and SERIAL_TX_PORT to the two tap devices, e.g. /dev/cu.usbserial-…'));
    process.exit(1);
  }

  const number = (name: string, fallback: number): number => {
    const value = Number(env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };

  const rxBaud = number('SERIAL_RX_BAUD', 9600);
  const txBaud = number('SERIAL_TX_BAUD', 9600);
  const tcpPort = number('SERIAL_LOGGER_TCP_PORT', 8899);
  const udpPort = number('SERIAL_LOGGER_UDP_PORT', 58899);

  const log = (message: string): void => {
    console.log(formatLogLine(message));
  };

  const { logger, capture } = createSerialLogger({
    openTap: openSerialTap,
    store: new CaptureStore(env.DEV_CAPTURE_DIR || '.dev-captures'),
  });

  const server = await startLoggerServer({ logger, tcpPort, udpPort, log });
  await capture.start({ rxPath, txPath, rxBaud, txBaud });

  log(`Listening on ${rxPath} (responses) and ${txPath} (requests); serving as a logger on TCP ${server.tcpPort} / UDP ${server.udpPort}. Ctrl+C to stop.`);

  const interval = setInterval(() => {
    const status = capture.status();
    const parts: string[] = [];
    if (status.ports.rx !== null) {
      parts.push(formatPort(status.ports.rx, 'RX'));
    }
    if (status.ports.tx !== null) {
      parts.push(formatPort(status.ports.tx, 'TX'));
    }
    const pairs = capture.records(0).filter((record) => record.kind === 'pair').length;
    log(`${parts.join('; ')} | ${pairs} recent reads`);
  }, 60000);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log('Shutting down');
    clearInterval(interval);
    await capture.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
};

main().catch((error: unknown) => {
  console.error(formatLogLine(error instanceof Error ? (error.stack ?? error.message) : String(error)));
  process.exit(1);
});
