import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { RegisterMap } from '../registers/register-map';
import { LoggerLink, type LoggerLinkStatus } from './logger-link';
import type { LoggerTransport } from './logger-transport';

/** Creates the transport for one logger address. Overridden in tests. */
export const LOGGER_TRANSPORT_FACTORY = Symbol('LOGGER_TRANSPORT_FACTORY');
export type LoggerTransportFactory = (host: string, port: number) => LoggerTransport;

const OFFLINE: LoggerLinkStatus = { state: 'offline', lastSuccessAt: null, lastError: null, retryAt: null };

/**
 * One LoggerLink per logger address, shared by everything that talks to
 * that logger (the poller, settings reads and writes), so their requests
 * are serialized on one connection.
 */
@Injectable()
export class LoggerLinks implements OnModuleDestroy {
  private readonly links = new Map<string, LoggerLink>();

  constructor(
    @Inject(LOGGER_TRANSPORT_FACTORY) private readonly createTransport: LoggerTransportFactory,
    private readonly registers: RegisterMap,
  ) {}

  get(host: string, port: number): LoggerLink {
    const key = `${host}:${port}`;
    let link = this.links.get(key);
    if (!link) {
      link = new LoggerLink({ transport: this.createTransport(host, port), registers: this.registers });
      this.links.set(key, link);
    }
    return link;
  }

  status(host: string, port: number): LoggerLinkStatus {
    return this.links.get(`${host}:${port}`)?.status() ?? OFFLINE;
  }

  /** Closes and forgets the link for an address no profile uses any more. */
  remove(host: string, port: number): void {
    const key = `${host}:${port}`;
    this.links.get(key)?.close();
    this.links.delete(key);
  }

  /**
   * Verifies a logger that isn't paired yet, on its own short-lived link so
   * a pairing check never disturbs (or is blocked by) a live poll loop.
   */
  async probe(host: string, port: number) {
    const link = new LoggerLink({ transport: this.createTransport(host, port), registers: this.registers });
    try {
      return await link.probe();
    } finally {
      link.close();
    }
  }

  onModuleDestroy(): void {
    for (const link of this.links.values()) link.close();
    this.links.clear();
  }
}
