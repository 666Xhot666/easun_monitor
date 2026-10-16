import { InMemoryLogger } from '../inverter/link/in-memory-logger';
import { decodeRequest } from '../inverter/protocol/logger-frame';
import type { CaptureStore } from '../inverter/serial-sniff/capture-store';
import { SerialCapture, type SerialTapFactory } from '../inverter/serial-sniff/serial-capture';
import { INVERTER_UNIT, READ_THROUGH_MS } from './constants';
import type { EspLink } from './esp-link';
import { RegisterRefresher } from './register-refresher';

/** "Server device busy": nothing has been heard for this register yet. */
const NOT_HEARD_YET = 6;

/**
 * The serial logger: a stand-in for the Wi-Fi logger, fed by listening to
 * the real logger's conversation with the inverter on two serial taps. Every
 * read the real logger makes updates the emulated register bank, which
 * keeps serving those values until the next read; registers never heard
 * answer an exception instead of an invented value, and writes are refused.
 * The capture is still saved, so register discovery continues meanwhile.
 */
export function createSerialLogger(options: {
  openTap: SerialTapFactory;
  store: CaptureStore;
  windowMs?: number;
}): { logger: InMemoryLogger; capture: SerialCapture } {
  const logger = new InMemoryLogger({
    isWritable: () => false, // writes answer "read-only register"

    unsetReadException: NOT_HEARD_YET,
  });
  const capture = new SerialCapture({
    openTap: options.openTap,
    store: options.store,
    windowMs: options.windowMs,
    onRecord: (record) => {
      if (record.kind === 'pair') logger.set(record.request.address, record.response.words);
    },
  });
  return { logger, capture };
}

/**
 * The serial logger on the ESP proxy: the same stand-in for the Wi-Fi
 * logger, hearing the real logger's conversation through the proxy. What
 * the app asks for is also read through the proxy first, unless the real
 * logger just read it (see RegisterRefresher), so the app gets fresh values
 * of every register. An exception the inverter answers is passed on to the
 * app. Writes are still refused. Give `prepare` to the logger server.
 */
export function createEspSerialLogger(options: { link: EspLink; store: CaptureStore; windowMs?: number }): {
  logger: InMemoryLogger;
  capture: SerialCapture;
  prepare: (frame: Buffer) => Promise<void>;
} {
  const logger = new InMemoryLogger({ isWritable: () => false, unsetReadException: NOT_HEARD_YET });
  const refresher = new RegisterRefresher({
    read: (address, count) => options.link.read(INVERTER_UNIT, address, count),
    onWords: (address, words) => {
      logger.acceptReadsAt(address);
      logger.set(address, words);
    },
    onException: (address, code) => logger.rejectReadsAt(address, code),
  });
  const capture = new SerialCapture({
    openTap: options.link.openTap,
    store: options.store,
    windowMs: options.windowMs,
    onRecord: (record) => {
      if (record.kind !== 'pair') return;
      logger.acceptReadsAt(record.request.address);
      logger.set(record.request.address, record.response.words);
      refresher.heard(record.request.address, record.request.quantity, Date.now());
    },
  });
  const prepare = async (frame: Buffer): Promise<void> => {
    const request = decodeRequest(frame);
    if (request.kind !== 'read') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => (timer = setTimeout(resolve, READ_THROUGH_MS)));
    await Promise.race([refresher.refresh(request.address, request.count, Date.now()), deadline]);
    clearTimeout(timer);
  };
  return { logger, capture, prepare };
}
