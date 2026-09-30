import * as net from 'node:net';
import { decodeReply, encodeRequest } from '../protocol/logger-frame';
import { InMemoryLogger } from './in-memory-logger';
import { startLoggerServer, type LoggerServer } from './logger-server';
import { TransportError } from './logger-transport';
import { TcpLoggerTransport } from './tcp-logger-transport';

const read = { kind: 'read', address: 202, count: 2 } as const;

describe('TcpLoggerTransport against a socket logger server', () => {
  let server: LoggerServer;
  let logger: InMemoryLogger;

  beforeEach(async () => {
    logger = new InMemoryLogger({ isWritable: () => true });
    logger.set(202, [2305, 5000]);
    server = await startLoggerServer({ logger, host: '127.0.0.1', tcpPort: 0, udpPort: 0 });
  });

  afterEach(() => server.close());

  const transport = (overrides: Partial<ConstructorParameters<typeof TcpLoggerTransport>[0]> = {}) =>
    new TcpLoggerTransport({
      host: '127.0.0.1',
      port: server.tcpPort,
      udpPort: server.udpPort,
      timeoutMs: 300,
      ...overrides,
    });

  it('handshakes, connects and exchanges frames', async () => {
    const t = transport();
    await t.connect();
    expect(t.connected).toBe(true);

    const reply = await t.exchange(encodeRequest(read));
    expect(decodeReply(read, reply)).toEqual([2305, 5000]);
    expect(server.handshakes).toBe(1);
    t.close();
    expect(t.connected).toBe(false);
  });

  it('fails the handshake when nothing answers on the discovery port', async () => {
    const t = transport({ udpPort: 1 });
    await expect(t.connect()).rejects.toThrow(TransportError);
    await expect(t.connect()).rejects.toThrow(/handshake/);
  });

  it('fails to connect when the TCP port is closed', async () => {
    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));

    await expect(transport({ port }).connect()).rejects.toThrow(TransportError);
  });

  it('times out and disconnects when the logger stops answering', async () => {
    const t = transport();
    await t.connect();
    server.pause();

    await expect(t.exchange(encodeRequest(read))).rejects.toThrow(/Timed out/);
    expect(t.connected).toBe(false);
  });
});
