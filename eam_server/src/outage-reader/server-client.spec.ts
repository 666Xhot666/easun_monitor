import { ReaderServerClient, ServerError } from './server-client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function fakeFetch(...answers: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const answer = answers.shift();
    if (!answer) throw new Error('unexpected request');
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const client = (fetch: typeof globalThis.fetch) =>
  new ReaderServerClient({
    url: 'http://localhost:3000/',
    token: 'tok',
    fetch,
  });

describe('ReaderServerClient', () => {
  it('asks which address to check, with its token', async () => {
    const address = {
      site: 'dnem',
      city: 'м. Тестове',
      street: 'вул. Тестова',
      house: '12а',
      enabled: true,
    };
    const { fetch, calls } = fakeFetch(json(address));
    expect(await client(fetch).source()).toEqual(address);
    expect(calls[0].url).toBe('http://localhost:3000/api/outage/reader/source');
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe(
      'Bearer tok',
    );
  });

  it("uploads the site's streets", async () => {
    const { fetch, calls } = fakeFetch(json({ changed: true }));
    await client(fetch).putStreets({ 'м. Тестове': ['вул. Тестова'] });
    expect(calls[0].url).toBe(
      'http://localhost:3000/api/outage/reader/streets',
    );
    expect(calls[0].init.method).toBe('PUT');
    expect(new Headers(calls[0].init.headers).get('content-type')).toBe(
      'application/json',
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      site: 'dnem',
      streets: { 'м. Тестове': ['вул. Тестова'] },
    });
  });

  it('sends a check', async () => {
    const { fetch, calls } = fakeFetch(json({ stored: true }, 202));
    await client(fetch).postCheck({
      checkedAt: 'x',
      outcome: 'server',
      usedBrowser: false,
      error: 'down',
    });
    expect(calls[0].url).toBe('http://localhost:3000/api/outage/reader/checks');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      outcome: 'server',
    });
  });

  it('reports a refused token apart from other failures', async () => {
    const refused = fakeFetch(
      json({ message: 'Unknown outage reader token' }, 401),
    );
    await expect(client(refused.fetch).source()).rejects.toMatchObject({
      name: 'ServerError',
      unauthorized: true,
    });

    const down = fakeFetch(new TypeError('fetch failed'));
    const error = await client(down.fetch)
      .source()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect(error).toMatchObject({ unauthorized: false });

    const bad = fakeFetch(
      json({ message: 'house.groups must be a list' }, 400),
    );
    await expect(client(bad.fetch).postCheck({})).rejects.toThrow(
      /400.*house\.groups must be a list/,
    );
  });
});
