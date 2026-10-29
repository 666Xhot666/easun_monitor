import { decodeCellInfo, CELL_INFO_FRAME } from '../bms/jk/cell-info';
import {
  decodeDeviceInfo,
  DEVICE_INFO_FRAME,
  variantForSoftware,
} from '../bms/jk/device-info';
import { FrameAssembler } from '../bms/jk/frame-assembler';
import { CELL_INFO, DEVICE_INFO, buildRequest } from '../bms/jk/requests';
import type { BmsProtocol } from '../bms/jk/variants';
import type { BmsReading, BmsSource } from '../bms/reading';
import type { BleConnection } from './noble-connection';
import {
  CELL_INFO_ASK_MS,
  FIRST_CELL_INFO_MS,
  WATCHDOG_CHECK_MS,
  WATCHDOG_MS,
} from './constants';

/** Bumped whenever decoding changes, so stored readings say which decoder made them. */
export const DECODER_VERSION = 'jk-ble/1';

export type SessionEvent =
  /** Every valid frame, raw, for the capture files. */
  | { kind: 'frame'; frameType: number; hex: string }
  | {
      kind:
        | 'device-info'
        | 'variant-warning'
        | 'frame-error'
        | 'decode-error'
        | 'watchdog-resend';
      detail: string;
    };

export interface SessionOptions {
  protocol: BmsProtocol;
  source: BmsSource;
  now: () => number;
  onReading: (reading: BmsReading) => void;
  onEvent: (event: SessionEvent) => void;
}

/**
 * One connection's worth of reading a JK BMS: subscribe, ask for device info
 * once, then for cell info every 5 s until the BMS starts streaming it, decode
 * what arrives, and watch for silence. `run` resolves with the reason the
 * session ended; the caller reconnects.
 */
export class BmsSession {
  private lastFrameAt = 0;
  private resent = false;
  private streaming = false;
  private connectedAt = 0;
  private lastCellInfoAskAt = 0;

  constructor(
    private readonly connection: BleConnection,
    private readonly options: SessionOptions,
  ) {}

  /** Until the BMS goes away or `signal` aborts: then it disconnects first, and ends with "Stopped". */
  run(signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve) => {
      let timer: ReturnType<typeof setInterval> | undefined;
      let done = false;
      const end = (reason: string, close: boolean) => {
        if (done) return;
        done = true;
        if (timer) clearInterval(timer);
        if (close) void this.connection.close().catch(() => {});
        resolve(reason);
      };
      const stop = () => {
        if (done) return;
        done = true;
        if (timer) clearInterval(timer);
        void this.connection
          .close()
          .catch(() => {})
          .then(() => resolve('Stopped'));
      };
      if (signal?.aborted) return stop();
      signal?.addEventListener('abort', stop, { once: true });

      const assembler = new FrameAssembler({
        onFrame: (frame) => this.handle(frame),
        onError: (detail) =>
          this.options.onEvent({ kind: 'frame-error', detail }),
      });
      this.connection.onData((chunk) => assembler.push(chunk));
      this.connection.onDisconnect((reason) =>
        end(`Disconnected: ${reason}`, false),
      );

      void (async () => {
        try {
          await this.connection.subscribe();
          this.lastFrameAt = this.options.now();
          this.connectedAt = this.options.now();
          this.lastCellInfoAskAt = this.options.now();
          await this.connection.write(buildRequest(DEVICE_INFO));
        } catch (error) {
          end(
            `Setup failed: ${error instanceof Error ? error.message : String(error)}`,
            true,
          );
          return;
        }
        const write = (frame: Buffer) =>
          this.connection.write(frame).catch((error: unknown) => {
            end(
              `Write failed: ${error instanceof Error ? error.message : String(error)}`,
              true,
            );
          });
        timer = setInterval(() => {
          const now = this.options.now();
          if (!this.streaming) {
            if (now - this.connectedAt >= FIRST_CELL_INFO_MS) {
              end('No cell info within 60 s of connecting', true);
            } else if (now - this.lastCellInfoAskAt >= CELL_INFO_ASK_MS) {
              this.lastCellInfoAskAt = now;
              void write(buildRequest(CELL_INFO));
            }
            return;
          }
          if (now - this.lastFrameAt < WATCHDOG_MS) return;
          if (this.resent) {
            end('No frame for 60 s after asking again', true);
            return;
          }
          this.resent = true;
          this.lastFrameAt = this.options.now();
          this.options.onEvent({
            kind: 'watchdog-resend',
            detail: 'No frame for 30 s, asking for cell info again',
          });
          void write(buildRequest(CELL_INFO));
        }, WATCHDOG_CHECK_MS);
      })();
    });
  }

  private handle(frame: Buffer): void {
    this.lastFrameAt = this.options.now();
    this.resent = false;
    const frameType = frame[4];
    this.options.onEvent({
      kind: 'frame',
      frameType,
      hex: frame.toString('hex'),
    });
    try {
      if (frameType === CELL_INFO_FRAME) {
        this.streaming = true;
        this.options.onReading({
          timestamp: new Date(this.options.now()).toISOString(),
          source: this.options.source,
          decoderVersion: DECODER_VERSION,
          ...decodeCellInfo(frame, this.options.protocol),
        });
      } else if (frameType === DEVICE_INFO_FRAME) {
        this.reportDeviceInfo(frame);
      }
    } catch (error) {
      this.options.onEvent({
        kind: 'decode-error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private reportDeviceInfo(frame: Buffer): void {
    const info = decodeDeviceInfo(frame);
    this.options.onEvent({
      kind: 'device-info',
      detail: `${info.model}, hardware ${info.hardwareVersion}, software ${info.softwareVersion}, serial ${info.serialNumber}`,
    });
    const suggested = variantForSoftware(info.softwareVersion);
    if (suggested && suggested !== this.options.protocol) {
      this.options.onEvent({
        kind: 'variant-warning',
        detail: `Software ${info.softwareVersion} usually means ${suggested}, but BMS_PROTOCOL is ${this.options.protocol}. Check the cell values; change BMS_PROTOCOL if they look wrong.`,
      });
    }
  }
}
