import { isAllowedRequest } from '../bms/jk/requests';

/** One open Bluetooth link to a BMS: notifications in, requests out. */
export interface BleConnection {
  readonly id: string;
  readonly name: string;
  subscribe(): Promise<void>;
  onData(listener: (chunk: Buffer) => void): void;
  onDisconnect(listener: (reason: string) => void): void;
  /** Writes a request. Rejects anything but the two read requests. */
  write(frame: Buffer): Promise<void>;
  close(): Promise<void>;
}

/** The parts of @stoprocent/noble's Characteristic this uses. */
export interface CharacteristicLike {
  writeAsync(data: Buffer, withoutResponse: boolean): Promise<void>;
  subscribeAsync(): Promise<void>;
  on(
    event: 'data',
    listener: (data: Buffer, isNotification: boolean) => void,
  ): unknown;
}

/** The parts of @stoprocent/noble's Peripheral this uses. */
export interface PeripheralLike {
  readonly id: string;
  readonly advertisement: { localName?: string };
  once(event: 'disconnect', listener: (reason: unknown) => void): unknown;
  disconnectAsync(): Promise<void>;
}

/**
 * The JK BMS characteristic (FFE1) over @stoprocent/noble. The same
 * characteristic accepts commands that change BMS settings and switch its
 * charge/discharge MOSFETs, so `write` is the one place bytes reach the BMS
 * and it refuses every frame that is not exactly a cell-info or device-info
 * request.
 */
export class NobleBmsConnection implements BleConnection {
  constructor(
    private readonly peripheral: PeripheralLike,
    private readonly characteristic: CharacteristicLike,
  ) {}

  get id(): string {
    return this.peripheral.id;
  }

  get name(): string {
    return this.peripheral.advertisement.localName ?? '';
  }

  subscribe(): Promise<void> {
    return this.characteristic.subscribeAsync();
  }

  onData(listener: (chunk: Buffer) => void): void {
    this.characteristic.on('data', (data) => listener(data));
  }

  onDisconnect(listener: (reason: string) => void): void {
    this.peripheral.once('disconnect', (reason) => listener(String(reason)));
  }

  async write(frame: Buffer): Promise<void> {
    if (!isAllowedRequest(frame)) {
      throw new Error(
        `Write refused: only the cell-info and device-info requests may be sent to the BMS (got ${frame.toString('hex')})`,
      );
    }
    await this.characteristic.writeAsync(frame, true);
  }

  close(): Promise<void> {
    return this.peripheral.disconnectAsync();
  }
}
