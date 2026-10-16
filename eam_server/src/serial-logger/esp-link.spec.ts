import { crc16 } from '../inverter/protocol/logger-frame';
import { EspLink, type DuplexPort } from './esp-link';

const withCrc = (bytes: number[]) => Buffer.concat([Buffer.from(bytes), crc16(Buffer.from(bytes))]);
const hex = (bytes: Buffer) => bytes.toString('hex').toUpperCase();

class FakePort implements DuplexPort {
  written: string[] = [];
  closed = false;
  private data: (chunk: Buffer) => void = () => {};
  private error: (error: Error) => void = () => {};
  onData(listener: (chunk: Buffer) => void) {
    this.data = listener;
  }
  onError(listener: (error: Error) => void) {
    this.error = listener;
  }
  write(text: string) {
    this.written.push(text);
  }
  async close() {
    this.closed = true;
  }
  say(text: string) {
    this.data(Buffer.from(text));
  }
  fail(message: string) {
    this.error(new Error(message));
  }
}

describe('EspLink', () => {
  let ports: FakePort[];
  let opens: number;
  let link: EspLink;
  const port = () => ports[ports.length - 1];

  beforeEach(async () => {
    jest.useFakeTimers();
    ports = [];
    opens = 0;
    link = new EspLink({
      path: '/dev/esp',
      openPort: async () => {
        opens++;
        const p = new FakePort();
        ports.push(p);
        return p;
      },
    });
    await link.start();
  });

  afterEach(async () => {
    await link.stop();
    jest.useRealTimers();
  });

  it("feeds the plug's requests and the inverter's replies to two taps", async () => {
    const requests: Buffer[] = [];
    const replies: Buffer[] = [];
    (await link.openTap('tx', 0)).onData((chunk) => requests.push(chunk));
    (await link.openTap('rx', 0)).onData((chunk) => replies.push(chunk));

    port().say('# ready esp_proxy\nP>I 10 01030000000AC5CD\nI>P 40 0103');
    port().say('02123488AA\r\n');

    expect(requests.map(hex)).toEqual(['01030000000AC5CD']);
    expect(replies.map(hex)).toEqual(['0103021234' + '88AA']);
  });

  it('sends our read and answers it with the reply from the inverter', async () => {
    const reply = link.read(1, 0x100, 2);
    await Promise.resolve();
    expect(port().written).toEqual(['010301000002C5F7\n']);

    port().say('D>I 50 010301000002C5F7\n');
    port().say(`I>D 80 ${hex(withCrc([1, 3, 4, 0, 7, 0, 8]))}\n`);
    await expect(reply).resolves.toEqual({ kind: 'words', words: [7, 8] });
  });

  it('puts together a reply that came over several lines', async () => {
    const reply = link.read(1, 0x100, 2);
    await Promise.resolve();
    const bytes = hex(withCrc([1, 3, 4, 0, 7, 0, 8]));
    port().say(`I>D 80 ${bytes.slice(0, 6)}\nI>D 95 ${bytes.slice(6)}\n`);
    await expect(reply).resolves.toEqual({ kind: 'words', words: [7, 8] });
  });

  it('gives nothing when the proxy reports a timeout or refuses the line', async () => {
    const first = link.read(1, 0, 1);
    await Promise.resolve();
    port().say('# timeout\n');
    await expect(first).resolves.toBeNull();

    const second = link.read(1, 0, 1);
    await Promise.resolve();
    port().say('# busy\n');
    await expect(second).resolves.toBeNull();
  });

  it('gives nothing when the proxy says nothing at all', async () => {
    const reply = link.read(1, 0, 1);
    await jest.advanceTimersByTimeAsync(3000);
    await expect(reply).resolves.toBeNull();
  });

  it('sends one read at a time', async () => {
    const first = link.read(1, 0, 1);
    const second = link.read(1, 1, 1);
    await Promise.resolve();
    expect(port().written).toHaveLength(1);

    port().say(`I>D 1 ${hex(withCrc([1, 3, 2, 0, 1]))}\n`);
    await expect(first).resolves.toEqual({ kind: 'words', words: [1] });
    await Promise.resolve();
    expect(port().written).toHaveLength(2);
    port().say(`I>D 2 ${hex(withCrc([1, 3, 2, 0, 2]))}\n`);
    await expect(second).resolves.toEqual({ kind: 'words', words: [2] });
  });

  it('reopens the port after it fails, and the taps keep working', async () => {
    const requests: Buffer[] = [];
    (await link.openTap('tx', 0)).onData((chunk) => requests.push(chunk));
    const pending = link.read(1, 0, 1);
    await Promise.resolve();

    port().fail('unplugged');
    await expect(pending).resolves.toBeNull();
    expect(link.status()).toMatchObject({ state: 'reconnecting', error: 'unplugged' });

    await jest.advanceTimersByTimeAsync(1000);
    expect(opens).toBe(2);
    expect(link.status()).toMatchObject({ state: 'open', reconnects: 1 });
    port().say('P>I 10 01030000000AC5CD\n');
    expect(requests).toHaveLength(1);
  });

  it('keeps trying to open a port that is not there', async () => {
    await link.stop();
    let attempts = 0;
    link = new EspLink({
      path: '/dev/esp',
      openPort: async () => {
        attempts++;
        throw new Error('No such file');
      },
    });
    await link.start();
    expect(link.status()).toMatchObject({ state: 'reconnecting', error: 'No such file' });
    await jest.advanceTimersByTimeAsync(1000 + 2000);
    expect(attempts).toBe(3);
    await expect(link.read(1, 0, 1)).resolves.toBeNull();
  });

  it('has only the two taps', async () => {
    await expect(link.openTap('/dev/other', 0)).rejects.toThrow(/tx or rx/);
  });
});
