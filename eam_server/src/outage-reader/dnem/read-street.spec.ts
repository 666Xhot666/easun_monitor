import { readStreet } from './read-street';
import { DnemSiteClient, USER_AGENT } from './site-client';
import {
  BASE,
  CHALLENGE,
  PAGE,
  fakeBrowser,
  fakeFetch,
  house,
  housesAnswer,
  html,
  json,
  kindOf,
} from './testing/site-fixtures';

const HOUSES = { result: true, data: { '12': house() } };
const noSleep = { sleep: () => Promise.resolve() };

describe('DnemSiteClient in a browser', () => {
  it('opens the page in the browser with the same identity, without a plain request', async () => {
    const { fetch, calls } = fakeFetch();
    const browser = fakeBrowser([PAGE]);
    const page = await new DnemSiteClient({
      baseUrl: BASE,
      fetch,
      openBrowser: browser.open,
    }).loadPage({ browser: true });
    expect(browser.opened).toEqual([
      { url: `${BASE}/ua/shutdowns`, userAgent: USER_AGENT },
    ]);
    expect(page.csrfToken).toBe('tok-1');
    expect(calls).toEqual([]);
  });

  it('asks for the houses from inside the browser page', async () => {
    const { fetch, calls } = fakeFetch();
    const browser = fakeBrowser([PAGE], housesAnswer(HOUSES));
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch,
      openBrowser: browser.open,
    });
    await client.loadPage({ browser: true });
    const houses = await client.houses('м. Тестове', 'вул. Тестова');

    expect(houses['12'].groups).toEqual(['GPV5.2']);
    expect(calls).toEqual([]);
    const [post] = browser.posts;
    expect(post.url).toBe(`${BASE}/ua/ajax`);
    expect(post.headers).toMatchObject({
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': 'tok-1',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    });
    expect(new URLSearchParams(post.body).get('data[1][value]')).toBe(
      'вул. Тестова',
    );
  });

  it('reports the firewall check when the browser does not get past it either', async () => {
    const browser = fakeBrowser([CHALLENGE]);
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch: fakeFetch().fetch,
      openBrowser: browser.open,
    });
    expect(await kindOf(client.loadPage({ browser: true }))).toBe('challenge');
  });

  it('closes the browser once', async () => {
    const browser = fakeBrowser([PAGE]);
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch: fakeFetch().fetch,
      openBrowser: browser.open,
    });
    await client.loadPage({ browser: true });
    await client.close();
    await client.close();
    expect(browser.closed).toBe(1);
  });
});

describe('readStreet', () => {
  it('uses plain requests when the site lets them through', async () => {
    const { fetch } = fakeFetch(html(PAGE), json(HOUSES));
    const browser = fakeBrowser([]);
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch,
      openBrowser: browser.open,
    });
    const result = await readStreet(client, 'м. Тестове', 'вул. Тестова', {
      retry: noSleep,
    });
    expect(result.usedBrowser).toBe(false);
    expect(result.houses['12'].groups).toEqual(['GPV5.2']);
    expect(result.page.csrfToken).toBe('tok-1');
    expect(browser.opened).toEqual([]);
  });

  it('switches to the browser when the page is behind the firewall check', async () => {
    const { fetch } = fakeFetch(html(CHALLENGE, 403));
    const browser = fakeBrowser([PAGE], housesAnswer(HOUSES));
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch,
      openBrowser: browser.open,
    });
    const result = await readStreet(client, 'м. Тестове', 'вул. Тестова', {
      retry: noSleep,
    });
    expect(result.usedBrowser).toBe(true);
    expect(result.houses['12'].groups).toEqual(['GPV5.2']);
    expect(browser.closed).toBe(1);
  });

  it('switches to the browser when the houses request is refused', async () => {
    const { fetch } = fakeFetch(html(PAGE), html('Bad Request', 400));
    const browser = fakeBrowser([PAGE], housesAnswer(HOUSES));
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch,
      openBrowser: browser.open,
    });
    const result = await readStreet(client, 'м. Тестове', 'вул. Тестова', {
      retry: noSleep,
    });
    expect(result.usedBrowser).toBe(true);
    expect(browser.posts).toHaveLength(1);
  });

  it('goes straight to the browser when asked, as for the weekly check', async () => {
    const { fetch, calls } = fakeFetch();
    const browser = fakeBrowser([PAGE], housesAnswer(HOUSES));
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch,
      openBrowser: browser.open,
    });
    const result = await readStreet(client, 'м. Тестове', 'вул. Тестова', {
      forceBrowser: true,
      retry: noSleep,
    });
    expect(result.usedBrowser).toBe(true);
    expect(calls).toEqual([]);
  });

  it('does not use the browser for a failing site, after retrying', async () => {
    const down = () => html('Bad gateway', 502);
    const { fetch, calls } = fakeFetch(down(), down(), down());
    const browser = fakeBrowser([]);
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch,
      openBrowser: browser.open,
    });
    const failure = readStreet(client, 'a', 'b', {
      retry: { ...noSleep, delaysMs: [1, 1] },
    });
    expect(await kindOf(failure)).toBe('server');
    expect(calls).toHaveLength(3);
    expect(browser.opened).toEqual([]);
  });

  it('does not use the browser for a changed site', async () => {
    const { fetch } = fakeFetch(html(PAGE), json({ result: true, data: [] }));
    const browser = fakeBrowser([]);
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch,
      openBrowser: browser.open,
    });
    expect(await kindOf(readStreet(client, 'a', 'b', { retry: noSleep }))).toBe(
      'shape',
    );
    expect(browser.opened).toEqual([]);
  });

  it('reports the block when the browser it needs cannot start', async () => {
    const { fetch } = fakeFetch(html(CHALLENGE));
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch,
      openBrowser: () =>
        Promise.reject(new Error('Playwright could not be loaded')),
    });
    const failure = readStreet(client, 'a', 'b', { retry: noSleep });
    await expect(failure).rejects.toMatchObject({
      name: 'SiteError',
      kind: 'challenge',
      message: expect.stringMatching(
        /browser could not start: Playwright could not be loaded/,
      ),
    });
  });

  it('closes the browser when the check fails in it', async () => {
    const { fetch } = fakeFetch(html(CHALLENGE));
    const browser = fakeBrowser([PAGE], housesAnswer({ result: false }));
    const client = new DnemSiteClient({
      baseUrl: BASE,
      fetch,
      openBrowser: browser.open,
    });
    expect(await kindOf(readStreet(client, 'a', 'b', { retry: noSleep }))).toBe(
      'rejected',
    );
    expect(browser.closed).toBe(1);
  });
});
