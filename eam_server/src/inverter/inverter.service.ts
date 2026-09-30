import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as dgram from 'node:dgram';
import * as net from 'node:net';
import * as os from 'node:os';
import { ConfigService } from '@nestjs/config';
import { InverterReading } from './interfaces/inverter-reading.interface';
import commandsData from './commands.json';
import {
  UDP_DISCOVERY_PORT,
  UDP_HANDSHAKE_FALLBACK_HOST,
  UDP_HANDSHAKE_EXPECTED_REPLY,
} from '../common/constants';
import {
  decodeReply,
  encodeRequest,
  frameLength,
  type LoggerRequest,
} from './protocol/logger-frame';

/**
 * One entry from commands.json's `get_smg_param` definition array. The
 * real file (from the EASUN SMG-II reverse-engineering effort — see
 * EASUN's own "SMG-RS232 Communication Protocol V1.0.1" PDF, mirrored at
 * github.com/syssi/esphome-smg-ii/blob/main/docs/, cross-checked against
 * github.com/makstt232/EASUN-ISOLAR-SMG-II-CONTROL) uses `address` (not
 * `hex`) and `rate` (a multiplier applied to the raw register value, not
 * a divisor).
 */
interface SmgParameterDefinition {
  num: string;
  name: string;
  address: string;
  type: string | number;
  rate?: number;
  format?: number;
  unit?: string | string[];
}

// Registers we know how to decode with a single 16-bit read. A handful of
// entries in commands.json use other `type` values that need their own
// multi-register parsing logic — out of scope here, so they're filtered
// out rather than mis-decoded as a plain UInt16.
//
// TODO: the SMG-II register map also defines Fault code (100 / 0x0064),
// Warning code (108 / 0x006C), and Serial number (186 / 0x00BA) — a
// ULong and a 12-register ASCII string respectively. None of the three
// are in get_smg_param's `definition` array below (same treatment the
// old SMX-II list gave its own type 3/4/20 entries — not a regression),
// so add them here once this filter grows real multi-register decoding.
const SUPPORTED_TYPES = new Set(['UInt16BE', 'Int16BE']);

function loadSmgParameterDefinitions(): SmgParameterDefinition[] {
  const getSmgParamCommand = commandsData.commands.find(
    (command) => command.name === 'get_smg_param',
  );
  const definitions = (getSmgParamCommand?.definition ??
    []) as SmgParameterDefinition[];
  return definitions.filter(
    (definition) =>
      Boolean(definition.address) &&
      SUPPORTED_TYPES.has(definition.type as string),
  );
}

// Parsed once at module load — commands.json is static data bundled with
// the app, not something that changes at runtime.
const PARAMETER_DEFINITIONS = loadSmgParameterDefinitions();

/**
 * Speaks the reverse-engineered UDP/Modbus TCP protocol to the EASUN
 * ISOLAR SMG-II's Wi-Fi Plug Pro adapter. This is the only place that
 * knows about UDP discovery, the custom packet framing, or CRC-16 — every
 * other module only ever sees `fetchDeviceData`'s plain InverterReading.
 */
@Injectable()
export class InverterService implements OnModuleDestroy {
  private readonly logger = new Logger(InverterService.name);

  // One persistent TCP connection per *device* (keyed by "ip:port"), not
  // a single shared connection — re-doing the UDP+TCP handshake on every
  // poll tick would be needlessly slow, and with multiple inverters now
  // pollable concurrently (one per InverterProfile, possibly several per
  // user), a single shared socket field would have two devices' polls
  // stomp on each other's connection.
  private readonly connections = new Map<string, net.Socket>();

  // Defaults sourced from .env (INVERTER_PORT / INVERTER_TIMEOUT_MS) when
  // present, falling back to sane values otherwise (see constructor) — an
  // explicitly-set-but-invalid value still fails fast at boot, same
  // philosophy as PollingService's POLLING_INTERVAL_MS validation.
  private readonly defaultTcpPort: number;
  private readonly requestTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    // Now just the *default* used when a caller doesn't pass its own port
    // (e.g. an old .env-only setup with no InverterProfile yet) — 8899
    // mirrors InverterProfile.port's own Prisma default, kept in sync
    // deliberately. Previously this threw if unset; that's no longer
    // appropriate now that a fresh install with no .env inverter config
    // is an expected, supported state (onboarding wizard hasn't run yet).
    const rawPort = this.configService.get<string>('INVERTER_PORT');
    if (rawPort !== undefined) {
      const parsedPort = Number(rawPort);
      const isValidPort =
        Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535;
      if (!isValidPort) {
        throw new Error(
          `INVERTER_PORT is set but is not a valid TCP port (got "${rawPort}"). ` +
            `Fix it or remove it from your .env file.`,
        );
      }
      this.defaultTcpPort = parsedPort;
    } else {
      this.defaultTcpPort = 8899;
    }

    // Same relaxation for the request timeout — a generic network-tuning
    // knob, not something the onboarding wizard collects, so it shouldn't
    // block boot just because .env wasn't customized.
    const rawTimeout = this.configService.get<string>('INVERTER_TIMEOUT_MS');
    if (rawTimeout !== undefined) {
      const parsedTimeout = Number(rawTimeout);
      const isValidTimeout = Number.isFinite(parsedTimeout) && parsedTimeout > 0;
      if (!isValidTimeout) {
        throw new Error(
          `INVERTER_TIMEOUT_MS is set but is not a valid positive number ` +
            `(got "${rawTimeout}"). Fix it or remove it from your .env file.`,
        );
      }
      this.requestTimeoutMs = parsedTimeout;
    } else {
      this.requestTimeoutMs = 3000;
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const key of this.connections.keys()) {
      this.teardownConnection(key);
    }
  }

  /**
   * Sequentially reads every supported register from commands.json and
   * returns whatever succeeded as a single flat object, e.g.
   * `{ LineVoltage: 230.5, BatterySoc: 100 }`.
   *
   * Each register is read in its own try/catch: a single bad/unsupported
   * register (dropped packet, CRC mismatch, timeout) is logged and
   * skipped rather than failing the entire poll cycle, since with ~85
   * registers polled every cycle, losing one shouldn't cost the other 84.
   * `ensureConnected` is re-checked at the start of every iteration (not
   * once before the loop) so that if a failure tears down the socket (see
   * handleSocketFailure/teardownSocket below), the next parameter
   * transparently reconnects instead of every remaining parameter in the
   * same cycle failing too.
   *
   * Only throws if *no* register could be read at all, which preserves
   * PollingService's existing "log and retry next tick" behavior for a
   * total outage (e.g. the inverter is unreachable). A partial success
   * returns a partial object — callers should not assume every key from
   * commands.json is always present.
   */
  async fetchDeviceData(
    ipAddress: string,
    port: number = this.defaultTcpPort,
  ): Promise<InverterReading> {
    if (!ipAddress) {
      throw new Error('fetchDeviceData: no inverter IP address provided');
    }

    const reading: InverterReading = {};

    for (const definition of PARAMETER_DEFINITIONS) {
      try {
        const socket = await this.ensureConnected(ipAddress, port);
        const request: LoggerRequest = {
          kind: 'read',
          address: parseInt(definition.address, 16),
          count: 1,
        };
        const response = await this.sendAndReceive(socket, encodeRequest(request));
        const [rawValue] = decodeReply(request, response);
        const signedValue =
          definition.type === 'Int16BE'
            ? this.toSigned16(rawValue)
            : rawValue;

        reading[definition.name] = definition.rate
          ? signedValue * definition.rate
          : signedValue;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Skipping ${definition.name} (${definition.address}) this cycle: ${message}`,
        );
      }
    }

    if (Object.keys(reading).length === 0) {
      throw new Error(
        `Failed to read any of the ${PARAMETER_DEFINITIONS.length} mapped parameters from ${ipAddress}`,
      );
    }

    return reading;
  }

  /**
   * Lightweight connectivity check for the setup wizard's "Verify Logger"
   * step — does the full protocol round trip (UDP handshake, TCP connect,
   * one real Modbus register read + CRC validation) so a green result
   * actually means the device speaks the expected protocol, not just that
   * something answered on the TCP port. Deliberately uses its own
   * short-lived socket rather than `ensureConnected`/`this.connections`,
   * so it never disturbs a persistent connection PollingService's poll
   * loop may already be holding open to another device while the user
   * is testing a new one in the wizard.
   */
  async testConnection(
    ipAddress: string,
    port: number = this.defaultTcpPort,
  ): Promise<{ success: true; latencyMs: number; sampledParameter: string }> {
    if (!ipAddress) {
      throw new Error('testConnection: no inverter IP address provided');
    }

    const [sample] = PARAMETER_DEFINITIONS;
    if (!sample) {
      throw new Error(
        'No supported parameters are defined in commands.json — cannot verify a real Modbus response',
      );
    }

    const startedAt = Date.now();
    await this.performUdpHandshake(ipAddress, port);
    // Not added to `this.connections` — this socket is opened and torn
    // down entirely within this method (see the class-level doc comment
    // above), so the key is only used to label log lines consistently.
    const socket = await this.openTcpSocket(ipAddress, port, this.connectionKey(ipAddress, port));

    try {
      const request: LoggerRequest = {
        kind: 'read',
        address: parseInt(sample.address, 16),
        count: 1,
      };
      const response = await this.sendAndReceive(socket, encodeRequest(request));
      // Throws on a short/malformed response or a CRC mismatch — this is
      // the actual verification, not just "the TCP handshake succeeded".
      decodeReply(request, response);

      return {
        success: true,
        latencyMs: Date.now() - startedAt,
        sampledParameter: sample.name,
      };
    } finally {
      socket.removeAllListeners();
      socket.destroy();
    }
  }

  /**
   * commands.json's `rate` values are positive multipliers, so a raw
   * register declared `Int16BE` has to be reinterpreted as signed *before*
   * that multiplication (e.g. sub-zero temperatures, or charge/discharge
   * current direction) — otherwise a negative reading comes back as a
   * large positive number instead.
   */
  private toSigned16(rawValue: number): number {
    return rawValue > 0x7fff ? rawValue - 0x10000 : rawValue;
  }

  // ---------------------------------------------------------------------
  // Connection lifecycle — one entry per "ip:port" device, so polling
  // several inverters concurrently never shares a socket between them.
  // ---------------------------------------------------------------------

  private connectionKey(ipAddress: string, port: number): string {
    return `${ipAddress}:${port}`;
  }

  private async ensureConnected(ipAddress: string, port: number): Promise<net.Socket> {
    const key = this.connectionKey(ipAddress, port);
    const existing = this.connections.get(key);
    if (existing && !existing.destroyed) {
      return existing;
    }

    // Stale socket (dead, or never connected) — start clean for this key.
    this.teardownConnection(key);

    await this.performUdpHandshake(ipAddress, port);
    const socket = await this.openTcpSocket(ipAddress, port, key);
    this.connections.set(key, socket);
    return socket;
  }

  private teardownConnection(key: string): void {
    const existing = this.connections.get(key);
    if (existing) {
      existing.removeAllListeners();
      existing.destroy();
    }
    this.connections.delete(key);
  }

  private handleSocketFailure(key: string, socket: net.Socket, error: Error): void {
    // Only touch the map entry if it's still *this* socket — a fresh
    // ensureConnected() call for the same key could already have
    // replaced it by the time this fires (a stale error/close event
    // racing a just-established reconnect), and tearing down the *new*
    // connection because the *old* one failed would be wrong.
    if (this.connections.get(key) !== socket) return;
    this.logger.warn(`Inverter TCP socket error (${key}): ${error.message}`);
    this.teardownConnection(key);
  }

  private handleSocketClose(key: string, socket: net.Socket): void {
    if (this.connections.get(key) !== socket) return;
    this.connections.delete(key);
  }

  // ---------------------------------------------------------------------
  // 1. UDP handshake (discovery) — wakes the plug up before it will
  //    accept a TCP connection.
  // ---------------------------------------------------------------------

  private performUdpHandshake(ipAddress: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const request = this.buildUdpHandshakeMessage(port);
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.close();
        fn();
      };

      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new Error(
              `UDP handshake with inverter at ${ipAddress} timed out after ${this.requestTimeoutMs}ms`,
            ),
          ),
        );
      }, this.requestTimeoutMs);

      socket.once('error', (error) => {
        finish(() =>
          reject(new Error(`UDP handshake with ${ipAddress} failed: ${error.message}`)),
        );
      });

      // Not `.once` — an unrelated stray datagram shouldn't end the wait;
      // only the exact expected reply resolves it, everything else is
      // ignored until it arrives or the timeout fires.
      socket.on('message', (message) => {
        if (message.toString('utf8').trim() === UDP_HANDSHAKE_EXPECTED_REPLY) {
          finish(resolve);
        }
      });

      socket.send(request, UDP_DISCOVERY_PORT, ipAddress, (error) => {
        if (error) {
          finish(() =>
            reject(new Error(`Failed to send UDP handshake to ${ipAddress}: ${error.message}`)),
          );
        }
      });
    });
  }

  private buildUdpHandshakeMessage(port: number): Buffer {
    // The adapter tolerates the literal placeholder host per the reverse
    // engineering notes, but sending our real local IP when we can
    // determine it is the technically correct behaviour to match what the
    // official app actually does.
    const host = this.getLocalIpAddress() ?? UDP_HANDSHAKE_FALLBACK_HOST;
    return Buffer.from(`set>server=${host}:${port};`, 'utf8');
  }

  private getLocalIpAddress(): string | null {
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal) {
          return entry.address;
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // TCP connect
  // ---------------------------------------------------------------------

  private openTcpSocket(ipAddress: string, port: number, key: string): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const onConnectError = (error: Error) => {
        finish(() => {
          socket.destroy();
          reject(new Error(`TCP connection to ${ipAddress}:${port} failed: ${error.message}`));
        });
      };

      socket.once('error', onConnectError);
      socket.setTimeout(this.requestTimeoutMs, () => {
        finish(() => {
          socket.destroy();
          reject(new Error(`TCP connection to ${ipAddress}:${port} timed out`));
        });
      });

      socket.connect(port, ipAddress, () => {
        finish(() => {
          socket.removeListener('error', onConnectError);
          socket.setTimeout(0);
          // Persistent handlers for the socket's working lifetime, distinct
          // from the one-shot handlers sendAndReceive attaches per request.
          // Bound to this specific socket instance (via the `socket !==`
          // identity check inside each handler) so a late event from an
          // already-replaced connection for the same key can't clobber
          // the new one.
          socket.on('error', (error) => this.handleSocketFailure(key, socket, error));
          socket.on('close', () => this.handleSocketClose(key, socket));
          resolve(socket);
        });
      });
    });
  }

  // ---------------------------------------------------------------------
  // Send / receive
  // ---------------------------------------------------------------------

  /**
   * Writes one request and resolves with the one complete reply frame that
   * answers it. Replies are cut from the stream with `frameLength`, since
   * TCP may deliver a frame in pieces. Requests are never sent concurrently
   * on the same socket: the transaction id is fixed, so an out-of-order
   * reply could not be matched to its request.
   */
  private sendAndReceive(socket: net.Socket, request: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let received = Buffer.alloc(0);

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          socket.destroy();
          reject(
            new Error(`Timed out waiting for inverter response after ${this.requestTimeoutMs}ms`),
          );
        });
      }, this.requestTimeoutMs);

      const onError = (error: Error) => {
        finish(() => {
          socket.destroy();
          reject(new Error(`Socket error while waiting for inverter response: ${error.message}`));
        });
      };

      const onData = (data: Buffer) => {
        received = Buffer.concat([received, data]);
        const length = frameLength(received);
        if (length !== null) {
          finish(() => resolve(received.subarray(0, length)));
        }
      };

      socket.on('error', onError);
      socket.on('data', onData);

      socket.write(request, (writeError) => {
        if (writeError) {
          finish(() => {
            socket.destroy();
            reject(new Error(`Failed to write to inverter socket: ${writeError.message}`));
          });
        }
      });
    });
  }
}
