/**
 * The seam between a Logger link and the network. A transport carries
 * whole frames to one logger and back; it knows nothing about registers.
 *
 * Adapters: TcpLoggerTransport (UDP handshake + TCP, production) and the
 * in-memory logger used by tests.
 */
export interface LoggerTransport {
  /** Performs the handshake and opens the connection. */
  connect(): Promise<void>;
  /** Sends one request frame and resolves with the one reply frame. Never
   * called concurrently. Throws TransportError when the link is broken, in
   * which case the transport is left disconnected. */
  exchange(frame: Buffer): Promise<Buffer>;
  close(): void;
  readonly connected: boolean;
}

/** The link itself failed (timeout, refused, reset), as opposed to the
 * logger answering with an error. */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}
