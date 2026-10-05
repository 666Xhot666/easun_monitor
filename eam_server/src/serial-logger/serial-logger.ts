import { InMemoryLogger } from '../inverter/link/in-memory-logger';
import type { CaptureStore } from '../inverter/serial-sniff/capture-store';
import { SerialCapture, type SerialTapFactory } from '../inverter/serial-sniff/serial-capture';

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
