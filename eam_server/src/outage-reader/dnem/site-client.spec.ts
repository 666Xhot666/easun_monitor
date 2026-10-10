import { DnemSiteClient, retrying } from './site-client';
import { SiteError } from './site-error';
import {
  BASE,
  PAGE,
  CHALLENGE,
  house,
  json,
  html,
  fakeFetch,
  header,
  kindOf,
} from './testing/site-fixtures';

describe('DnemSiteClient', () => {
  it('loads the schedule page like a browser and parses it', async () => {
    const { fetch, calls } = fakeFetch(html(PAGE));
    const page = await new DnemSiteClient({ fetch }).loadPage();
    expect(calls[0].url).toBe(`${BASE}/ua/shutdowns`);
    expect(calls[0].init.method ?? 'GET').toBe('GET');
    expect(header(calls[0], 'user-agent')).toMatch(/Chrome\//);
    expect(header(calls[0], 'accept-language')).toMatch(/^uk/);
    expect(page.csrfToken).toBe('tok-1');
    expect(page.streets).toEqual({ 'м. Дніпро': ['вул. Тестова'] });
  });

  it("asks for a street's houses with the page's cookies and token", async () => {
    const { fetch, calls } = fakeFetch(
      html(PAGE, 200, [
        'visid_incap_1=abc; path=/; HttpOnly',
        '_csrf-dtek-dnem=xyz; path=/',
      ]),
      json({
        result: true,
        data: { '12': house() },
        updateTimestamp: '20:16 10.10.2026',
      }),
    );
    const client = new DnemSiteClient({ fetch });
    await client.loadPage();
    await client.houses('м. Дніпро', 'вул. Тестова');

    const post = calls[1];
    expect(post.url).toBe(`${BASE}/ua/ajax`);
    expect(post.init.method).toBe('POST');
    expect(header(post, 'content-type')).toMatch(
      /^application\/x-www-form-urlencoded/,
    );
    expect(header(post, 'x-requested-with')).toBe('XMLHttpRequest');
    expect(header(post, 'x-csrf-token')).toBe('tok-1');
    expect(header(post, 'origin')).toBe(BASE);
    expect(header(post, 'referer')).toBe(`${BASE}/ua/shutdowns`);
    expect(header(post, 'cookie')).toBe(
      'visid_incap_1=abc; _csrf-dtek-dnem=xyz',
    );
    expect(
      Object.fromEntries(new URLSearchParams(String(post.init.body))),
    ).toEqual({
      method: 'getHomeNum',
      'data[0][name]': 'city',
      'data[0][value]': 'м. Дніпро',
      'data[1][name]': 'street',
      'data[1][value]': 'вул. Тестова',
      'data[2][name]': 'updateFact',
      'data[2][value]': '24.07.2026 08:30',
    });
  });

  it("reads each house's groups and its current outage, in UTC", async () => {
    const { fetch } = fakeFetch(
      html(PAGE),
      json({
        result: true,
        data: {
          '329': house({
            sub_type: 'Аварійні ремонтні роботи',
            start_date: '18:05 10.10.2026',
            end_date: '22:05 10.10.2026',
            type: '2',
          }),
          '12а': house({ sub_type_reason: ['GPV5.2', 'GPV1.1'] }),
          '14': house({ sub_type_reason: [] }),
        },
      }),
    );
    const client = new DnemSiteClient({ fetch });
    await client.loadPage();
    expect(await client.houses('м. Дніпро', 'вул. Тестова')).toEqual({
      '329': {
        groups: ['GPV5.2'],
        outage: {
          description: 'Аварійні ремонтні роботи',
          type: '2',
          start: new Date('2026-10-10T15:05:00Z'),
          end: new Date('2026-10-10T19:05:00Z'),
        },
      },
      '12а': { groups: ['GPV5.2', 'GPV1.1'], outage: null },
      '14': { groups: [], outage: null },
    });
  });

  it('needs the page before asking for houses', async () => {
    const { fetch } = fakeFetch();
    await expect(
      new DnemSiteClient({ fetch }).houses('a', 'b'),
    ).rejects.toThrow(/loadPage/);
  });

  describe('tells failures apart', () => {
    it('a failing site', async () => {
      const { fetch } = fakeFetch(html('<h1>Bad gateway</h1>', 502));
      expect(await kindOf(new DnemSiteClient({ fetch }).loadPage())).toBe(
        'server',
      );
    });

    it('a busy site', async () => {
      const { fetch } = fakeFetch(html('slow down', 429));
      expect(await kindOf(new DnemSiteClient({ fetch }).loadPage())).toBe(
        'server',
      );
    });

    it('no answer', async () => {
      const { fetch } = fakeFetch(new TypeError('fetch failed'));
      expect(await kindOf(new DnemSiteClient({ fetch }).loadPage())).toBe(
        'network',
      );
    });

    it('the firewall check instead of the page, whatever its status', async () => {
      for (const status of [200, 403]) {
        const { fetch } = fakeFetch(html(CHALLENGE, status));
        expect(await kindOf(new DnemSiteClient({ fetch }).loadPage())).toBe(
          'challenge',
        );
      }
    });

    it('the firewall check instead of the houses', async () => {
      const { fetch } = fakeFetch(html(PAGE), html(CHALLENGE));
      const client = new DnemSiteClient({ fetch });
      await client.loadPage();
      expect(await kindOf(client.houses('a', 'b'))).toBe('challenge');
    });

    it('a refused request', async () => {
      const { fetch } = fakeFetch(html(PAGE), html('Bad Request', 400));
      const client = new DnemSiteClient({ fetch });
      await client.loadPage();
      expect(await kindOf(client.houses('a', 'b'))).toBe('rejected');
    });

    it('a refusal in the answer', async () => {
      const { fetch } = fakeFetch(html(PAGE), json({ result: false }));
      const client = new DnemSiteClient({ fetch });
      await client.loadPage();
      expect(await kindOf(client.houses('a', 'b'))).toBe('rejected');
    });

    it('houses in an unexpected form', async () => {
      const bad = [
        { result: true, data: { '1': house({ sub_type_reason: 'GPV5.2' }) } },
        {
          result: true,
          data: { '1': house({ start_date: '18:05 10.10.2026' }) },
        },
        {
          result: true,
          data: { '1': house({ start_date: 'soon', end_date: 'later' }) },
        },
        { result: true, data: [] },
        { result: true },
      ];
      for (const body of bad) {
        const { fetch } = fakeFetch(html(PAGE), json(body));
        const client = new DnemSiteClient({ fetch });
        await client.loadPage();
        expect(await kindOf(client.houses('a', 'b'))).toBe('shape');
      }
    });
  });

  it('gives up on a request that takes too long', async () => {
    const fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason),
        );
      })) as unknown as typeof globalThis.fetch;
    expect(
      await kindOf(new DnemSiteClient({ fetch, timeoutMs: 20 }).loadPage()),
    ).toBe('network');
  });
});

describe('retrying', () => {
  const sleeps: number[] = [];
  const sleep = (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
  beforeEach(() => sleeps.splice(0));

  it('retries server and network failures with growing pauses', async () => {
    const failures = [
      new SiteError('network', 'x'),
      new SiteError('server', 'y'),
    ];
    const result = await retrying(
      () => {
        const failure = failures.shift();
        return failure ? Promise.reject(failure) : Promise.resolve('ok');
      },
      { delaysMs: [1000, 5000, 20000], sleep },
    );
    expect(result).toBe('ok');
    expect(sleeps).toEqual([1000, 5000]);
  });

  it('gives up after the last pause with the last failure', async () => {
    const attempt = () => Promise.reject(new SiteError('server', 'down'));
    await expect(
      retrying(attempt, { delaysMs: [1, 2], sleep }),
    ).rejects.toThrow('down');
    expect(sleeps).toEqual([1, 2]);
  });

  it('does not retry a challenge, a refusal or a changed site', async () => {
    for (const kind of ['challenge', 'rejected', 'shape'] as const) {
      let attempts = 0;
      const attempt = () => {
        attempts++;
        return Promise.reject(new SiteError(kind, kind));
      };
      await expect(
        retrying(attempt, { delaysMs: [1, 2], sleep }),
      ).rejects.toThrow(kind);
      expect(attempts).toBe(1);
    }
    expect(sleeps).toEqual([]);
  });
});
