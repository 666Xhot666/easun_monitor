/**
 * The serial logger service: run on the machine wired to the Wi-Fi logger's
 * TTL pads (two USB-serial taps), it answers the main app as if it were the
 * Wi-Fi logger itself, with the values the real logger last read from the
 * inverter. Pair it in the setup wizard at this machine's address (from
 * Docker: host.docker.internal), port 8899. Read-only on the taps; nothing
 * is written to them or the inverter.
 *
 *   SERIAL_RX_PORT=/dev/cu.usbserial-A SERIAL_TX_PORT=/dev/cu.usbserial-B npm run serial-logger
 *
 * With ESP_PORT set it runs on the ESP proxy instead of the two taps: it
 * hears the same conversation through the proxy, and reads through it what
 * the app asks for before answering, unless the Wi-Fi logger just read it.
 * Settings the app writes go to the inverter through the proxy; each one is
 * logged.
 *
 *   ESP_PORT=/dev/cu.usbserial-C npm run serial-logger
 */
import { startLoggerServer } from '../inverter/link/logger-server';
import { CaptureStore } from '../inverter/serial-sniff/capture-store';
import type { PortStatus } from '../inverter/serial-sniff/serial-capture';
import { openSerialTap } from '../inverter/serial-sniff/serial-port-tap';
import { ESP_BAUD } from './constants';
import { EspLink } from './esp-link';
import { openEspPort } from './esp-port';
import { formatLogLine } from './log-line';
import { createEspSerialLogger, createSerialLogger } from './serial-logger';

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
  if (env.ESP_PORT) return runOnEsp(env.ESP_PORT);
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

/** The serial logger on the ESP proxy (ESP_PORT). */
const runOnEsp = async (espPath: string): Promise<void> => {
  const env = process.env;
  const number = (name: string, fallback: number): number => {
    const value = Number(env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  const tcpPort = number('SERIAL_LOGGER_TCP_PORT', 8899);
  const udpPort = number('SERIAL_LOGGER_UDP_PORT', 58899);
  const log = (message: string): void => {
    console.log(formatLogLine(message));
  };

  const esp = new EspLink({
    path: espPath,
    baudRate: number('ESP_BAUD', ESP_BAUD),
    openPort: openEspPort,
    onNote: (text) => {
      if (text !== 'timeout') log(`ESP: ${text}`);
    },
  });
  const { logger, capture, prepare } = createEspSerialLogger({
    link: esp,
    store: new CaptureStore(env.DEV_CAPTURE_DIR || '.dev-captures'),
    log,
  });

  const server = await startLoggerServer({ logger, tcpPort, udpPort, log, prepare });
  await esp.start();
  await capture.start({ rxPath: 'rx', txPath: 'tx', rxBaud: 9600, txBaud: 9600 });
  log(`Listening on the ESP proxy at ${espPath}; serving as a logger on TCP ${server.tcpPort} / UDP ${server.udpPort}. Ctrl+C to stop.`);

  const status = setInterval(() => {
    const link = esp.status();
    let text = `ESP ${link.state}`;
    if (link.error !== null) text += ` (${link.error})`;
    if (link.reconnects > 0) text += `, ${link.reconnects} reconnects`;
    const pairs = capture.records(0).filter((record) => record.kind === 'pair').length;
    log(`${text} | ${pairs} recent reads by the Wi-Fi logger`);
  }, 60000);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Shutting down');
    clearInterval(status);
    await capture.stop();
    await esp.stop();
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
