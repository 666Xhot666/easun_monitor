import type { OpenBrowser } from '../../browser';
import { SiteError } from '../site-error';

/** A fake outage site for the reader's tests. */

export const BASE = 'https://outage-site.test';

export const slots = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [String(i + 1), 'yes']),
);
export const hourly = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => {
    const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
    return [String(i + 1), ['x', hh(i), i === 23 ? '24:00' : hh(i + 1)]];
  }),
);
export const preset = {
  sch_names: { 'GPV5.2': 'Черга 5.2' },
  time_zone: hourly,
  data: {
    'GPV5.2': Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), slots]),
    ),
  },
};
export const PAGE =
  '<html><head><meta name="ajaxUrl" content="/ua/ajax" /><meta name="csrf-token" content="tok-1"></head><body><script>\n' +
  `DisconSchedule.streets = ${JSON.stringify({ 'м. Тестове': ['вул. Тестова'] })}\n` +
  `DisconSchedule.preset = ${JSON.stringify(preset)}\n` +
  `DisconSchedule.fact = ${JSON.stringify({ data: [], update: '24.07.2026 08:30', today: 1791579600 })}</script></body></html>`;
export const CHALLENGE =
  '<html><head><script src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3"></script></head></html>';

export const house = (over: Record<string, unknown> = {}) => ({
  sub_type: '',
  start_date: '',
  end_date: '',
  type: '',
  sub_type_reason: ['GPV5.2'],
  voluntarily: null,
  cek: null,
  ...over,
});

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
export const html = (body: string, status = 200, cookies: string[] = []) =>
  new Response(body, {
    status,
    headers: [
      ['content-type', 'text/html; charset=UTF-8'],
      ...cookies.map((c): [string, string] => ['set-cookie', c]),
    ],
  });

export interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that answers from a queue and records each call. */
export function fakeFetch(...answers: Array<Response | Error>) {
  const calls: Call[] = [];
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

export const header = (call: Call, name: string) =>
  new Headers(call.init.headers).get(name);

export async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof SiteError) return e.kind;
    throw e;
  }
  throw new Error('expected a SiteError');
}

export interface FakeBrowser {
  open: OpenBrowser;
  opened: Array<{ url: string; userAgent: string }>;
  posts: Array<{ url: string; body: string; headers: Record<string, string> }>;
  closed: number;
}

/**
 * A browser that shows `pages` in turn, one per open, and answers posts from
 * `answers` in turn.
 */
export function fakeBrowser(
  pages: string[],
  ...answers: Array<{ status: number; body: string }>
): FakeBrowser {
  const fake: FakeBrowser = {
    opened: [],
    posts: [],
    closed: 0,
    open: (url, options) => {
      fake.opened.push({ url, userAgent: options.userAgent });
      const html = pages.shift();
      if (html === undefined)
        return Promise.reject(new Error('unexpected browser open'));
      return Promise.resolve({
        html,
        post: (postUrl, body, headers) => {
          fake.posts.push({ url: postUrl, body, headers });
          const answer = answers.shift();
          return answer
            ? Promise.resolve(answer)
            : Promise.reject(new Error('unexpected post'));
        },
        close: () => {
          fake.closed++;
          return Promise.resolve();
        },
      });
    },
  };
  return fake;
}

export const housesAnswer = (body: unknown, status = 200) => ({
  status,
  body: JSON.stringify(body),
});
