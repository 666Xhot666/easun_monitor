import { InMemoryLogger } from '../inverter/link/in-memory-logger';
import { decodeRequest } from '../inverter/protocol/logger-frame';
import type { CaptureStore } from '../inverter/serial-sniff/capture-store';
import { SerialCapture, type SerialTapFactory } from '../inverter/serial-sniff/serial-capture';
import { wordCount } from '../inverter/registers/register-map';
import { SMG_II_REGISTERS } from '../inverter/registers/smg-ii.registers';
import { INVERTER_UNIT, READ_THROUGH_MS, WRITE_THROUGH_MS } from './constants';
import type { EspLink } from './esp-link';
import { RegisterRefresher } from './register-refresher';

/** "Server device busy": nothing has been heard for this register yet. */
const NOT_HEARD_YET = 6;
/** "Read-only register": the register map does not let it be written. */
const NOT_WRITABLE = 1;
/** "Gateway target failed to respond": the inverter did not answer a write. */
const NO_ANSWER = 11;

/** Registers the map lets the app write: verified and writable. */
const WRITABLE = new Set(
  SMG_II_REGISTERS.filter((r) => r.writable && r.verified !== false).flatMap((r) =>
    Array.from({ length: wordCount(r) }, (_, i) => r.address + i),
  ),
);

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
 * app. A write is sent to the inverter and taken only once the inverter has
 * taken it; registers the map does not let be written are refused without
 * being sent. Give `prepare` to the logger server.
 */
export function createEspSerialLogger(options: {
  link: EspLink;
  store: CaptureStore;
  windowMs?: number;
  /** Told about every write: taken or refused. */
  log?: (message: string) => void;
}): {
  logger: InMemoryLogger;
  capture: SerialCapture;
  prepare: (frame: Buffer) => Promise<void>;
} {
  /** Registers of the write being answered that the inverter has taken. */
  const taken = new Set<number>();
  const logger = new InMemoryLogger({
    isWritable: (address) => taken.has(address),
    unsetReadException: NOT_HEARD_YET,
    onWrite: (address, values) => values.forEach((_, i) => taken.delete(address + i)),
  });
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
  const write = async (address: number, values: readonly number[]): Promise<void> => {
    values.forEach((_, i) => taken.delete(address + i));
    logger.acceptWritesAt(address);
    const what = `write of [${values.join(', ')}] at ${address}`;
    if (!values.every((_, i) => WRITABLE.has(address + i))) {
      logger.rejectWritesAt(address, NOT_WRITABLE);
      options.log?.(`Refused a ${what}: not writable in the register map`);
      return;
    }
    // Whatever the outcome, the app's read-back must come from the inverter.
    refresher.stale(address, values.length);
    const reply = await within(WRITE_THROUGH_MS, options.link.write(INVERTER_UNIT, address, values));
    if (reply?.kind === 'written') {
      values.forEach((_, i) => taken.add(address + i));
      options.log?.(`The inverter took a ${what}`);
    } else if (reply?.kind === 'exception') {
      logger.rejectWritesAt(address, reply.code);
      options.log?.(`The inverter refused a ${what}: exception ${reply.code}`);
    } else {
      logger.rejectWritesAt(address, NO_ANSWER);
      options.log?.(`The inverter did not answer a ${what}`);
    }
  };
  const prepare = async (frame: Buffer): Promise<void> => {
    const request = decodeRequest(frame);
    if (request.kind === 'write') return write(request.address, request.values);
    await within(READ_THROUGH_MS, refresher.refresh(request.address, request.count, Date.now()));
  };
  return { logger, capture, prepare };
}

/** `work`'s result, or null once `ms` have passed without one. */
async function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
