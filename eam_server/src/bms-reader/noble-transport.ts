import {
  NobleBmsConnection,
  type BleConnection,
  type CharacteristicLike,
  type PeripheralLike,
} from './noble-connection';
import { withTimeout } from './with-timeout';

/** JK BMS GATT service and characteristic (notifications in, writes out). */
const SERVICE = 'ffe0';
const CHARACTERISTIC = 'ffe1';

interface DiscoveredPeripheral extends PeripheralLike {
  readonly rssi: number;
  connectAsync(): Promise<void>;
  discoverSomeServicesAndCharacteristicsAsync(
    services: string[],
    characteristics: string[],
  ): Promise<{ characteristics: CharacteristicLike[] }>;
}

interface NobleLike {
  readonly state: string;
  waitForPoweredOnAsync(timeout?: number): Promise<void>;
  startScanningAsync(
    serviceUUIDs?: string[],
    allowDuplicates?: boolean,
  ): Promise<void>;
  stopScanningAsync(): Promise<void>;
  on(
    event: 'discover',
    listener: (peripheral: DiscoveredPeripheral) => void,
  ): unknown;
  removeListener(
    event: 'discover',
    listener: (peripheral: DiscoveredPeripheral) => void,
  ): unknown;
}

let noble: NobleLike | null = null;

/**
 * Loads @stoprocent/noble on first use only: it is a native module (an
 * optional dependency the server image does not need), and loading it
 * starts the Bluetooth stack, which on macOS asks the user for permission.
 */
async function loadNoble(): Promise<NobleLike> {
  if (noble) return noble;
  const name = '@stoprocent/noble';
  const mod = (await import(name)) as { default?: NobleLike } & NobleLike;
  noble = mod.default ?? mod;
  try {
    await noble.waitForPoweredOnAsync(10_000);
  } catch {
    const hint =
      noble.state === 'unauthorized'
        ? 'macOS has not allowed this terminal or IDE to use Bluetooth (System Settings > Privacy & Security > Bluetooth)'
        : `Bluetooth is ${noble.state}`;
    throw new Error(`Bluetooth is not available: ${hint}`);
  }
  return noble;
}

export interface SeenPeripheral {
  id: string;
  name: string;
  rssi: number;
}

/** Every peripheral advertising within `ms`, strongest signal first. */
export async function scanPeripherals(ms: number): Promise<SeenPeripheral[]> {
  const ble = await loadNoble();
  const seen = new Map<string, SeenPeripheral>();
  const onDiscover = (p: DiscoveredPeripheral) =>
    seen.set(p.id, {
      id: p.id,
      name: p.advertisement.localName ?? '',
      rssi: p.rssi,
    });
  ble.on('discover', onDiscover);
  await ble.startScanningAsync([], false);
  await new Promise((resolve) => setTimeout(resolve, ms));
  await ble.stopScanningAsync();
  ble.removeListener('discover', onDiscover);
  return [...seen.values()].sort((a, b) => b.rssi - a.rssi);
}

/** Finds the BMS by id or name prefix, connects and returns its FFE1 link. */
export async function connectBms(
  target: { name: string; id: string | null },
  timeoutMs = 20_000,
): Promise<BleConnection> {
  const ble = await loadNoble();
  const peripheral = await new Promise<DiscoveredPeripheral>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        ble.removeListener('discover', onDiscover);
        void ble.stopScanningAsync();
        reject(
          new Error(
            `No BMS ${target.id ? `with id ${target.id}` : `named ${target.name}*`} found in ${timeoutMs / 1000} s`,
          ),
        );
      }, timeoutMs);
      const onDiscover = (p: DiscoveredPeripheral) => {
        const matches = target.id
          ? p.id === target.id
          : (p.advertisement.localName ?? '').startsWith(target.name);
        if (!matches) return;
        clearTimeout(timer);
        ble.removeListener('discover', onDiscover);
        void ble.stopScanningAsync().then(() => resolve(p));
      };
      ble.on('discover', onDiscover);
      void ble.startScanningAsync([], false);
    },
  );

  const name = peripheral.advertisement.localName ?? peripheral.id;
  const { characteristics } = await withTimeout(
    peripheral
      .connectAsync()
      .then(() =>
        peripheral.discoverSomeServicesAndCharacteristicsAsync(
          [SERVICE],
          [CHARACTERISTIC],
        ),
      ),
    timeoutMs,
    `Connecting to ${name} took over ${timeoutMs / 1000} s (is another app, like the JK app, connected to it?)`,
    // Also cancels a connect still pending.
    () => void peripheral.disconnectAsync().catch(() => undefined),
  );
  if (characteristics.length === 0) {
    await peripheral.disconnectAsync();
    throw new Error(`${name} has no FFE1 characteristic: not a JK BMS?`);
  }
  return new NobleBmsConnection(peripheral, characteristics[0]);
}
