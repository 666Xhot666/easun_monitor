import { EventEmitter } from 'node:events';
import { CELL_INFO, DEVICE_INFO, buildRequest } from '../bms/jk/requests';
import { NobleBmsConnection } from './noble-connection';

class FakeCharacteristic extends EventEmitter {
  writes: { data: Buffer; withoutResponse: boolean }[] = [];
  subscribed = false;
  writeAsync(data: Buffer, withoutResponse: boolean) {
    this.writes.push({ data, withoutResponse });
    return Promise.resolve();
  }
  subscribeAsync() {
    this.subscribed = true;
    return Promise.resolve();
  }
}

class FakePeripheral extends EventEmitter {
  id = 'c0ffee';
  advertisement = { localName: 'JK-B2A8S20P' };
  disconnected = false;
  disconnectAsync() {
    this.disconnected = true;
    return Promise.resolve();
  }
}

function connection() {
  const characteristic = new FakeCharacteristic();
  const peripheral = new FakePeripheral();
  return {
    characteristic,
    peripheral,
    link: new NobleBmsConnection(peripheral, characteristic),
  };
}

/** A correctly framed and checksummed request with any command byte. */
function frameWithCommand(command: number) {
  const frame = Buffer.from(buildRequest(CELL_INFO));
  frame[4] = command;
  frame[19] = [...frame.subarray(0, 19)].reduce((a, b) => (a + b) & 0xff, 0);
  return frame;
}

describe('NobleBmsConnection', () => {
  it('writes the two read requests, without response', async () => {
    const { characteristic, link } = connection();

    await link.write(buildRequest(DEVICE_INFO));
    await link.write(buildRequest(CELL_INFO));

    expect(characteristic.writes).toEqual([
      { data: buildRequest(DEVICE_INFO), withoutResponse: true },
      { data: buildRequest(CELL_INFO), withoutResponse: true },
    ]);
  });

  it('refuses any other frame before it reaches Bluetooth', async () => {
    const { characteristic, link } = connection();

    // 0x1d and 0x1e switch the MOSFETs in the reference; 0x01-0x30 change settings.
    for (const command of [0x1d, 0x1e, 0x01, 0x05, 0xa1]) {
      await expect(link.write(frameWithCommand(command))).rejects.toThrow(
        /refused/,
      );
    }
    await expect(link.write(Buffer.from('anything'))).rejects.toThrow(
      /refused/,
    );
    expect(characteristic.writes).toEqual([]);
  });

  it('subscribes, passes notifications on, and reports a disconnect', async () => {
    const { characteristic, peripheral, link } = connection();
    const chunks: Buffer[] = [];
    const drops: string[] = [];
    link.onData((chunk) => chunks.push(chunk));
    link.onDisconnect((reason) => drops.push(reason));

    await link.subscribe();
    characteristic.emit('data', Buffer.from([1, 2]), true);
    peripheral.emit('disconnect', 'link lost');

    expect(characteristic.subscribed).toBe(true);
    expect(chunks).toEqual([Buffer.from([1, 2])]);
    expect(drops).toEqual(['link lost']);
    expect(link.name).toBe('JK-B2A8S20P');
  });

  it('disconnects on close', async () => {
    const { peripheral, link } = connection();
    await link.close();
    expect(peripheral.disconnected).toBe(true);
  });
});
