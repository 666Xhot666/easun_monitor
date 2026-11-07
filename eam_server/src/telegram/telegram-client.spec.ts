import { HttpTelegramClient } from './telegram-client';
import { REQUEST_TIMEOUT_MS } from './constants';

/** A fetch that never answers, except by failing when its signal aborts. */
const silentFetch = jest.fn(
  (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted', 'TimeoutError')),
      );
    }),
);

describe('HttpTelegramClient', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    silentFetch.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('gives up on a request without an answer, without the token in the error', async () => {
    const client = new HttpTelegramClient(
      '123:secret',
      silentFetch as unknown as typeof fetch,
    );
    const sent = client.sendMessage('42', 'hi');
    const failed = expect(sent).rejects.toThrow(/sendMessage: no answer/);
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await failed;
    await expect(sent).rejects.not.toThrow(/secret/);
  });

  it('waits for a long poll the poll time plus the usual margin', async () => {
    const client = new HttpTelegramClient(
      '123:secret',
      silentFetch as unknown as typeof fetch,
    );
    let settled = false;
    const polled = client.getUpdates(0, 30).catch((e: Error) => {
      settled = true;
      return e;
    });
    await jest.advanceTimersByTimeAsync(30_000 + REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(String(await polled)).toMatch(/getUpdates: no answer/);
  });
});
