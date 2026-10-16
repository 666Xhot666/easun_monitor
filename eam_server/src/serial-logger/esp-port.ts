import type { DuplexPort } from './esp-link';

/**
 * Opens the ESP proxy's USB serial port for reading and writing. The native
 * module is loaded only when the port is opened.
 */
export async function openEspPort(path: string, baudRate: number): Promise<DuplexPort> {
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
    write: (text) => {
      port.write(text);
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (!port.isOpen) return resolve();
        port.close(() => resolve());
      }),
  };
}
