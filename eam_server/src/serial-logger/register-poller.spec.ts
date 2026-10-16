import { FAILED_RETRY_MS, REFRESH_MS, WANTED_FOR_MS } from './constants';
import type { ReadReply } from './esp-protocol';
import { RegisterPoller } from './register-poller';

describe('RegisterPoller', () => {
  let reads: Array<{ address: number; count: number }>;
  let answer: (address: number, count: number) => ReadReply | null;
  let words: Array<{ address: number; words: number[] }>;
  let exceptions: Array<{ address: number; code: number }>;
  let poller: RegisterPoller;

  beforeEach(() => {
    reads = [];
    words = [];
    exceptions = [];
    answer = (address, count) => ({ kind: 'words', words: Array.from({ length: count }, (_, i) => address + i) });
    poller = new RegisterPoller({
      read: async (address, count) => {
        reads.push({ address, count });
        return answer(address, count);
      },
      onWords: (address, w) => words.push({ address, words: w }),
      onException: (address, code) => exceptions.push({ address, code }),
    });
  });

  it('reads nothing the app has not asked for', async () => {
    await expect(poller.poll(0)).resolves.toBe(false);
    expect(reads).toEqual([]);
  });

  it('reads a block the app asked for, then again once its values are old', async () => {
    poller.want(200, 3, 0);
    await expect(poller.poll(0)).resolves.toBe(true);
    expect(words).toEqual([{ address: 200, words: [200, 201, 202] }]);

    await expect(poller.poll(REFRESH_MS - 1)).resolves.toBe(false);
    await expect(poller.poll(REFRESH_MS)).resolves.toBe(true);
    expect(reads).toHaveLength(2);
  });

  it('leaves a block alone while the plug keeps it fresh', async () => {
    poller.want(200, 3, 0);
    poller.heard(200, 3, 0);
    await expect(poller.poll(1000)).resolves.toBe(false);

    poller.heard(200, 2, REFRESH_MS); // the plug read only part of it
    await expect(poller.poll(REFRESH_MS)).resolves.toBe(true);
  });

  it('reads the stalest block first', async () => {
    poller.want(100, 1, 0);
    poller.want(200, 1, 0);
    poller.heard(100, 1, 0);
    await poller.poll(REFRESH_MS);
    await poller.poll(REFRESH_MS);
    expect(reads.map((r) => r.address)).toEqual([200, 100]);
  });

  it('waits before trying a failed block again', async () => {
    answer = () => null;
    poller.want(200, 1, 0);
    await poller.poll(0);
    await expect(poller.poll(FAILED_RETRY_MS - 1)).resolves.toBe(false);
    await expect(poller.poll(FAILED_RETRY_MS)).resolves.toBe(true);
  });

  it("passes on the inverter's exception", async () => {
    answer = () => ({ kind: 'exception', code: 2 });
    poller.want(900, 4, 0);
    await poller.poll(0);
    expect(exceptions).toEqual([{ address: 900, code: 2 }]);
    expect(words).toEqual([]);
    await expect(poller.poll(1)).resolves.toBe(false);
  });

  it('stops reading a block the app no longer asks for', async () => {
    poller.want(200, 1, 0);
    await poller.poll(0);
    await expect(poller.poll(WANTED_FOR_MS)).resolves.toBe(false);

    poller.want(200, 1, WANTED_FOR_MS + 1);
    await expect(poller.poll(WANTED_FOR_MS + 1)).resolves.toBe(true);
  });

  it('reads one block at a time', async () => {
    let release: (reply: ReadReply | null) => void = () => {};
    poller = new RegisterPoller({
      read: (address, count) => {
        reads.push({ address, count });
        return new Promise((resolve) => (release = resolve));
      },
      onWords: () => {},
      onException: () => {},
    });
    poller.want(100, 1, 0);
    poller.want(200, 1, 0);
    const first = poller.poll(0);
    await expect(poller.poll(0)).resolves.toBe(false);
    release({ kind: 'words', words: [1] });
    await first;
    expect(reads).toHaveLength(1);
  });
});
