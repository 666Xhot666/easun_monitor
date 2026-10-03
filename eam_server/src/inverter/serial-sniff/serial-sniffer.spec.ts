import { SerialSniffer, type SerialTap } from './serial-sniffer';

const bytes = (hex: string) => Buffer.from(hex.replace(/ /g, ''), 'hex');
const ONE_WORD = '01 03 02 08 fc bf c5';
const TWO_WORDS = '01 03 04 00 14 00 32 3b e2';

/** A serial tap the test drives by hand. */
class FakeTap implements SerialTap {
  closed = false;
  private data: (chunk: Buffer) => void = () => {};
  private error: (error: Error) => void = () => {};
  onData(listener: (chunk: Buffer) => void) {
    this.data = listener;
  }
  onError(listener: (error: Error) => void) {
    this.error = listener;
  }
  async close() {
    this.closed = true;
  }
  receive(hex: string) {
    this.data(bytes(hex));
  }
  fail(message: string) {
    this.error(new Error(message));
  }
}

function setup(maxFrames?: number) {
  const taps: { path: string; baudRate: number; tap: FakeTap }[] = [];
  const sniffer = new SerialSniffer(async (path, baudRate) => {
    const tap = new FakeTap();
    taps.push({ path, baudRate, tap });
    return tap;
  }, { maxFrames, now: () => new Date('2026-10-03T12:00:00.000Z') });
  return { sniffer, taps };
}

describe('SerialSniffer', () => {
  it('opens the port at 9600 baud and numbers the frames it hears', async () => {
    const { sniffer, taps } = setup();
    await sniffer.start('/dev/cu.usbserial-1');
    expect(taps[0]).toMatchObject({ path: '/dev/cu.usbserial-1', baudRate: 9600 });

    taps[0].tap.receive(`${ONE_WORD} ${TWO_WORDS}`);

    expect(sniffer.frames(0)).toEqual([
      { seq: 1, receivedAt: '2026-10-03T12:00:00.000Z', unit: 1, func: 3, byteCount: 2, words: [2300], hex: ONE_WORD },
      expect.objectContaining({ seq: 2, words: [20, 50] }),
    ]);
    expect(sniffer.frames(1).map((f) => f.seq)).toEqual([2]);
    expect(sniffer.status()).toMatchObject({ running: true, path: '/dev/cu.usbserial-1', error: null });
  });

  it('stops listening and closes the port', async () => {
    const { sniffer, taps } = setup();
    await sniffer.start('/dev/cu.usbserial-1');
    await sniffer.stop();
    expect(taps[0].tap.closed).toBe(true);
    expect(sniffer.status().running).toBe(false);
  });

  it('closes the previous port when started on another one', async () => {
    const { sniffer, taps } = setup();
    await sniffer.start('/dev/cu.a');
    await sniffer.start('/dev/cu.b');
    expect(taps[0].tap.closed).toBe(true);
    expect(sniffer.status().path).toBe('/dev/cu.b');
  });

  it('reports a port that cannot be opened or fails while listening', async () => {
    const failing = new SerialSniffer(async () => {
      throw new Error('Resource busy');
    });
    await expect(failing.start('/dev/cu.x')).rejects.toThrow('Resource busy');
    expect(failing.status()).toMatchObject({ running: false, error: 'Resource busy' });

    const { sniffer, taps } = setup();
    await sniffer.start('/dev/cu.a');
    taps[0].tap.fail('Device unplugged');
    expect(sniffer.status()).toMatchObject({ running: false, error: 'Device unplugged' });
  });

  it('keeps only the most recent frames, and keeps numbering', async () => {
    const { sniffer, taps } = setup(2);
    await sniffer.start('/dev/cu.a');
    taps[0].tap.receive(`${ONE_WORD} ${ONE_WORD} ${TWO_WORDS}`);
    expect(sniffer.frames(0).map((f) => f.seq)).toEqual([2, 3]);
  });

  it('attaches a note to a frame', async () => {
    const { sniffer, taps } = setup();
    await sniffer.start('/dev/cu.a');
    taps[0].tap.receive(ONE_WORD);
    expect(sniffer.note(1, 'app shows output voltage 230 V')).toBe(true);
    expect(sniffer.note(99, 'gone')).toBe(false);
    expect(sniffer.frames(0)[0].note).toBe('app shows output voltage 230 V');
  });
});
