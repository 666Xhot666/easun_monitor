import { FAILED_RETRY_MS, FRESH_MS } from './constants';
import type { ReadReply } from './esp-protocol';
import { RegisterRefresher } from './register-refresher';

describe('RegisterRefresher', () => {
  let reads: Array<{ address: number; count: number }>;
  let answer: (address: number, count: number) => Promise<ReadReply | null>;
  let words: Array<{ address: number; words: number[] }>;
  let exceptions: Array<{ address: number; code: number }>;
  let refresher: RegisterRefresher;

  beforeEach(() => {
    reads = [];
    words = [];
    exceptions = [];
    answer = async (address, count) => ({ kind: 'words', words: Array.from({ length: count }, (_, i) => address + i) });
    refresher = new RegisterRefresher({
      read: (address, count) => {
        reads.push({ address, count });
        return answer(address, count);
      },
      onWords: (address, w) => words.push({ address, words: w }),
      onException: (address, code) => exceptions.push({ address, code }),
    });
  });

  it('reads a block nobody has heard', async () => {
    await refresher.refresh(200, 3, 0);
    expect(words).toEqual([{ address: 200, words: [200, 201, 202] }]);
  });

  it('leaves alone a block whose values are fresh, whoever read them', async () => {
    await refresher.refresh(200, 3, 0);
    await refresher.refresh(200, 3, FRESH_MS - 1);
    refresher.heard(200, 3, FRESH_MS); // the plug read it
    await refresher.refresh(200, 3, 2 * FRESH_MS - 1);
    expect(reads).toHaveLength(1);

    await refresher.refresh(200, 3, 2 * FRESH_MS);
    expect(reads).toHaveLength(2);
  });

  it('reads a block again once a write has made its values stale', async () => {
    refresher.heard(301, 1, 0);
    refresher.stale(301, 1);
    await refresher.refresh(301, 1, 1);
    expect(reads).toHaveLength(1);
  });

  it('reads a block again after a write even when its last read failed', async () => {
    answer = async () => null;
    await refresher.refresh(300, 12, 0);
    refresher.stale(301, 1);
    await refresher.refresh(300, 12, 1);
    expect(reads).toHaveLength(2);
  });

  it('reads a block when only part of it is fresh', async () => {
    refresher.heard(200, 2, 0);
    await refresher.refresh(200, 3, 0);
    expect(reads).toHaveLength(1);
  });

  it('does not try a failed block again for a while', async () => {
    answer = async () => null;
    await refresher.refresh(200, 1, 0);
    await refresher.refresh(200, 1, FAILED_RETRY_MS - 1);
    expect(reads).toHaveLength(1);
    await refresher.refresh(200, 1, FAILED_RETRY_MS);
    expect(reads).toHaveLength(2);
  });

  it("passes on the inverter's exception, and asks again only when it is stale", async () => {
    answer = async () => ({ kind: 'exception', code: 2 });
    await refresher.refresh(900, 4, 0);
    await refresher.refresh(900, 4, FRESH_MS - 1);
    expect(exceptions).toEqual([{ address: 900, code: 2 }]);
    expect(words).toEqual([]);
    await refresher.refresh(900, 4, FRESH_MS);
    expect(exceptions).toHaveLength(2);
  });

  it('shares one read between requests for the same block at once', async () => {
    let release: () => void = () => {};
    answer = (address, count) =>
      new Promise((resolve) => (release = () => resolve({ kind: 'words', words: Array.from({ length: count }, () => address) })));
    const first = refresher.refresh(200, 1, 0);
    const second = refresher.refresh(200, 1, 0);
    release();
    await Promise.all([first, second]);
    expect(reads).toHaveLength(1);
  });
});
