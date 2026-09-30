/**
 * Puts an InMemoryLogger behind the same sockets as a real Wi-Fi Plug Pro:
 * the UDP discovery handshake and the framed TCP protocol. Used by the
 * simulator (scripts/mock-inverter.ts) and by the TCP transport's tests.
 *
 * Only type-erasable TypeScript with explicit .ts imports, so Node can run
 * it directly from the simulator.
 */
import * as dgram from 'node:dgram';
import * as net from 'node:net';
import { frameLength, LoggerFrameError } from '../protocol/logger-frame.ts';
import type { InMemoryLogger } from './in-memory-logger.ts';

export const HANDSHAKE_PREFIX = 'set>server=';
export const HANDSHAKE_REPLY = 'rsp>server=1;';

export interface LoggerServerOptions {
  logger: InMemoryLogger;
  host?: string;
  /** 0 picks a free port. */
  tcpPort: number;
  udpPort: number;
  log?: (message: string) => void;
}

export interface LoggerServer {
  readonly tcpPort: number;
  readonly udpPort: number;
  /** Handshakes answered so far. */
  readonly handshakes: number;
  /** Stop answering TCP requests (simulates a hung logger). */
  pause(): void;
  close(): Promise<void>;
}

export async function startLoggerServer(options: LoggerServerOptions): Promise<LoggerServer> {
  const host = options.host ?? '0.0.0.0';
  const log = options.log ?? (() => {});
  let handshakes = 0;
  let paused = false;
  const sockets = new Set<net.Socket>();

  const udp = dgram.createSocket('udp4');
  udp.on('message', (message, remote) => {
    const text = message.toString('utf8');
    if (!text.startsWith(HANDSHAKE_PREFIX)) return;
    handshakes++;
    log(`UDP handshake from ${remote.address}:${remote.port} -> "${text.trim()}"`);
    udp.send(Buffer.from(HANDSHAKE_REPLY, 'utf8'), remote.port, remote.address);
  });

  const tcp = net.createServer((socket) => {
    sockets.add(socket);
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    log(`TCP client connected: ${remote}`);
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (let length = frameLength(buffer); length !== null; length = frameLength(buffer)) {
        const frame = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        if (paused) continue;
        try {
          socket.write(options.logger.handle(frame));
        } catch (error) {
          if (!(error instanceof LoggerFrameError)) throw error;
          log(`Dropping malformed frame from ${remote}: ${error.message}`);
        }
      }
    });
    socket.on('error', (error) => log(`TCP socket error (${remote}): ${error.message}`));
    socket.on('close', () => {
      sockets.delete(socket);
      log(`TCP client disconnected: ${remote}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    udp.once('error', reject);
    udp.bind(options.udpPort, host, () => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    tcp.once('error', reject);
    tcp.listen(options.tcpPort, host, () => resolve());
  });

  return {
    tcpPort: (tcp.address() as net.AddressInfo).port,
    udpPort: udp.address().port,
    get handshakes() {
      return handshakes;
    },
    pause() {
      paused = true;
    },
    close() {
      for (const socket of sockets) socket.destroy();
      udp.close();
      return new Promise<void>((resolve) => tcp.close(() => resolve()));
    },
  };
}
