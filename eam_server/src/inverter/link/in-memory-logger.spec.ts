import { decodeReply, encodeRequest, LoggerFrameError, type LoggerRequest } from '../protocol/logger-frame';
import { InMemoryLogger } from './in-memory-logger';

const exchange = (logger: InMemoryLogger, request: LoggerRequest) => decodeReply(request, logger.handle(encodeRequest(request)));

describe('InMemoryLogger', () => {
  it('answers never-set registers with 0 by default', () => {
    const logger = new InMemoryLogger({ isWritable: () => true });
    expect(exchange(logger, { kind: 'read', address: 300, count: 2 })).toEqual([0, 0]);
  });

  it('can refuse to read registers it has never been given, instead of inventing values', () => {
    const logger = new InMemoryLogger({ isWritable: () => false, unsetReadException: 6 });
    const read = { kind: 'read', address: 300, count: 2 } as const;
    expect(() => exchange(logger, read)).toThrow(LoggerFrameError);

    logger.set(300, [12, 34]);
    expect(exchange(logger, read)).toEqual([12, 34]);

    logger.set(400, [1]);
    expect(() => exchange(logger, { kind: 'read', address: 400, count: 2 })).toThrow(/exception code 6/);
  });
});
