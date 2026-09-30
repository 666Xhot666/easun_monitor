import * as dgram from 'node:dgram';
import * as net from 'node:net';
import * as os from 'node:os';
import { frameLength } from '../protocol/logger-frame';
import { TransportError, type LoggerTransport } from './logger-transport';

/** UDP port the Wi-Fi Plug Pro listens on for the discovery handshake. */
export const UDP_DISCOVERY_PORT = 58899;
const HANDSHAKE_REPLY = 'rsp>server=1;';
/** Host the adapter tolerates in the handshake when our own LAN address
 * is unknown; what the vendor's app sends in that case. */
const HANDSHAKE_FALLBACK_HOST = 'PHONE_WIFI_IP';

export interface TcpLoggerTransportOptions {
  host: string;
  /** The logger's TCP port (8899 on the Wi-Fi Plug Pro). */
  port: number;
  /** Applies to the handshake, the TCP connect and each reply. */
  timeoutMs: number;
  udpPort?: number;
}

/**
 * Production LoggerTransport: wakes the Wi-Fi Plug Pro with its UDP
 * discovery handshake, then holds one TCP connection to it, cutting reply
 * frames out of the stream by their declared length.
 *
 * Transport direction (the server dials the logger) is what works against
 * the simulator; it is still to be confirmed on real hardware.
 */
export class TcpLoggerTransport implements LoggerTransport {
  private socket: net.Socket | null = null;
  private readonly options: TcpLoggerTransportOptions;

  constructor(options: TcpLoggerTransportOptions) {
    this.options = options;
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  async connect(): Promise<void> {
    this.close();
    await this.handshake();
    this.socket = await this.openSocket();
  }

  exchange(frame: Buffer): Promise<Buffer> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new TransportError('Not connected to the logger'));
    }

    return new Promise((resolve, reject) => {
      let received = Buffer.alloc(0);

      const cleanup = () => {
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('close', onClose);
      };
      const failWith = (message: string) => {
        cleanup();
        this.close();
        reject(new TransportError(message));
      };
      const onData = (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        const length = frameLength(received);
        if (length !== null) {
          cleanup();
          resolve(received.subarray(0, length));
        }
      };
      const onError = (error: Error) => failWith(`Logger connection error: ${error.message}`);
      const onClose = () => failWith('Logger closed the connection');
      const timer = setTimeout(
        () => failWith(`Timed out waiting for the logger after ${this.options.timeoutMs}ms`),
        this.options.timeoutMs,
      );

      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('close', onClose);
      socket.write(frame, (error) => {
        if (error) failWith(`Failed to write to the logger: ${error.message}`);
      });
    });
  }

  close(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }

  // -------------------------------------------------------------------------

  private handshake(): Promise<void> {
    const { host, port, timeoutMs } = this.options;
    const udpPort = this.options.udpPort ?? UDP_DISCOVERY_PORT;
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      let settled = false;
      const finish = (error?: TransportError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.close();
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(
        () => finish(new TransportError(`UDP handshake with ${host} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      socket.on('error', (error) =>
        finish(new TransportError(`UDP handshake with ${host} failed: ${error.message}`)),
      );
      // Ignore stray datagrams: only the exact reply completes the handshake.
      socket.on('message', (message) => {
        if (message.toString('utf8').trim() === HANDSHAKE_REPLY) finish();
      });

      const announce = Buffer.from(`set>server=${localIpAddress() ?? HANDSHAKE_FALLBACK_HOST}:${port};`);
      socket.send(announce, udpPort, host, (error) => {
        if (error) finish(new TransportError(`UDP handshake with ${host} failed: ${error.message}`));
      });
    });
  }

  private openSocket(): Promise<net.Socket> {
    const { host, port, timeoutMs } = this.options;
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const fail = (message: string) => {
        socket.removeAllListeners();
        socket.destroy();
        reject(new TransportError(message));
      };
      socket.once('error', (error) => fail(`TCP connection to ${host}:${port} failed: ${error.message}`));
      socket.setTimeout(timeoutMs, () => fail(`TCP connection to ${host}:${port} timed out`));
      socket.connect(port, host, () => {
        socket.removeAllListeners();
        socket.setTimeout(0);
        // A late error on an idle socket just marks it dead; the next
        // exchange reports it.
        socket.on('error', () => socket.destroy());
        resolve(socket);
      });
    });
  }
}

function localIpAddress(): string | null {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}
