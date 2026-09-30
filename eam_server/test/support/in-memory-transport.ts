import { InMemoryLogger } from '../../src/inverter/link/in-memory-logger';
import { TransportError, type LoggerTransport } from '../../src/inverter/link/logger-transport';

/** In-process adapter at the transport seam: frames go straight to an
 * in-memory logger, or fail as an unreachable logger would (null). */
export class InMemoryTransport implements LoggerTransport {
  connected = false;
  exchanges = 0;

  constructor(private readonly logger: InMemoryLogger | null) {}

  async connect(): Promise<void> {
    if (!this.logger) throw new TransportError('UDP handshake timed out');
    this.connected = true;
  }

  async exchange(frame: Buffer): Promise<Buffer> {
    this.exchanges++;
    return this.logger!.handle(frame);
  }

  close(): void {
    this.connected = false;
  }
}
