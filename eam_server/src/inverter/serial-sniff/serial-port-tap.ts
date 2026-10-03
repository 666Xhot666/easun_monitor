import type { SerialTap } from './serial-capture';

/**
 * Opens a real serial port (e.g. /dev/cu.usbserial-*) at 9600 8N1 for
 * reading. Nothing is ever written to it. The native module is loaded only
 * when a port is opened, so the server starts without it being used.
 */
export async function openSerialTap(path: string, baudRate: number): Promise<SerialTap> {
  const { SerialPort } = await import('serialport');
  const port = new SerialPort({ path, baudRate, dataBits: 8, parity: 'none', stopBits: 1, autoOpen: false });
  await new Promise<void>((resolve, reject) => port.open((error) => (error ? reject(error) : resolve())));
  return {
    onData: (listener) => port.on('data', listener),
    onError: (listener) => {
      port.on('error', listener);
      port.on('close', (error?: Error | null) => {
        if (error) listener(error);
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (!port.isOpen) return resolve();
        port.close(() => resolve());
      }),
  };
}
