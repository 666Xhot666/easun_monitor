import { SiteError } from './site-error';
import { parseSchedulePage, type SchedulePage } from './schedule-page';
import { wallToUtc } from './windows';

export interface HouseOutage {
  description: string;
  type: string;
  start: Date;
  end: Date;
}

export interface HouseInfo {
  groups: string[];
  outage: HouseOutage | null;
}

export interface SiteClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function parseSiteTime(text: string, house: string): Date {
  const match = /^(\d{2}):(\d{2}) (\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (!match) {
    throw new SiteError('shape', `House ${house}: bad time format`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const day = Number(match[3]);
  const month = Number(match[4]);
  const year = Number(match[5]);
  return new Date(wallToUtc({ year, month, day }, hours * 60 + minutes));
}

function parseHouse(house: string, raw: unknown): HouseInfo {
  if (!isPlainObject(raw)) {
    throw new SiteError('shape', `House ${house}: not an object`);
  }

  const groupsRaw = raw.sub_type_reason;
  if (
    !Array.isArray(groupsRaw) ||
    !groupsRaw.every((g) => typeof g === 'string')
  ) {
    throw new SiteError('shape', `House ${house}: bad groups`);
  }
  const groups = groupsRaw as string[];

  const startDate = raw.start_date;
  const endDate = raw.end_date;
  if (typeof startDate !== 'string' || typeof endDate !== 'string') {
    throw new SiteError('shape', `House ${house}: bad dates`);
  }

  let outage: HouseOutage | null = null;
  if (startDate !== '' || endDate !== '') {
    if (startDate === '' || endDate === '') {
      throw new SiteError('shape', `House ${house}: one date missing`);
    }
    const start = parseSiteTime(startDate, house);
    const end = parseSiteTime(endDate, house);
    const description = raw.sub_type;
    const type = raw.type;
    if (typeof description !== 'string' || typeof type !== 'string') {
      throw new SiteError('shape', `House ${house}: bad type fields`);
    }
    outage = { description, type, start, end };
  }

  return { groups, outage };
}

export class DnemSiteClient {
  private fetch: typeof globalThis.fetch;
  private baseUrl: string;
  private timeoutMs: number;
  private cookieJar = new Map<string, string>();
  private page: SchedulePage | null = null;
  private pageUrl: string;

  constructor(options: SiteClientOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? 'https://www.dtek-dnem.com.ua';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.pageUrl = this.baseUrl + '/ua/shutdowns';
  }

  private async request(
    url: string,
    init: RequestInit,
  ): Promise<{ status: number; body: string }> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'uk,en;q=0.8',
    };

    if (this.cookieJar.size > 0) {
      const cookieStr = [...this.cookieJar.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
      headers['Cookie'] = cookieStr;
    }

    if (init.headers) {
      const initHeaders = new Headers(init.headers);
      initHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    }

    let response: Response;
    try {
      response = await this.fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new SiteError('network', `No answer from the site: ${message}`);
    }

    const setCookies = response.headers.getSetCookie();
    for (const cookie of setCookies) {
      const part = cookie.split(';')[0];
      const eqIndex = part.indexOf('=');
      if (eqIndex > 0) {
        const name = part.slice(0, eqIndex).trim();
        const value = part.slice(eqIndex + 1).trim();
        this.cookieJar.set(name, value);
      }
    }

    const body = await response.text();
    return { status: response.status, body };
  }

  private classify(status: number, body: string): void {
    if (
      (body.includes('_Incapsula_Resource') ||
        body.includes('Request unsuccessful')) &&
      !body.includes('DisconSchedule.') &&
      !body.startsWith('{')
    ) {
      throw new SiteError(
        'challenge',
        'The site answered with a firewall challenge',
      );
    }
    if (status === 429 || status >= 500) {
      throw new SiteError('server', `The site answered HTTP ${status}`);
    }
    if (status >= 400) {
      throw new SiteError(
        'rejected',
        `The site refused the request: HTTP ${status}`,
      );
    }
  }

  async loadPage(): Promise<SchedulePage> {
    const { status, body } = await this.request(this.pageUrl, {
      method: 'GET',
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    this.classify(status, body);
    this.page = parseSchedulePage(body, this.pageUrl);
    return this.page;
  }

  async houses(
    city: string,
    street: string,
  ): Promise<Record<string, HouseInfo>> {
    if (this.page === null) {
      throw new Error('Call loadPage() before houses()');
    }

    const page = this.page;
    const params = new URLSearchParams();
    params.append('method', 'getHomeNum');
    params.append('data[0][name]', 'city');
    params.append('data[0][value]', city);
    params.append('data[1][name]', 'street');
    params.append('data[1][value]', street);
    params.append('data[2][name]', 'updateFact');
    params.append('data[2][value]', page.confirmed.updated);

    const { status, body } = await this.request(page.ajaxUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': page.csrfToken,
        Origin: this.baseUrl,
        Referer: this.pageUrl,
      },
      body: params.toString(),
    });

    this.classify(status, body);

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new SiteError('shape', 'The houses answer is not JSON');
    }

    if (!isPlainObject(parsed)) {
      throw new SiteError('shape', 'The houses answer is not an object');
    }

    if (parsed.result === false) {
      throw new SiteError('rejected', 'The site refused the houses request');
    }

    const data = parsed.data;
    if (!isPlainObject(data)) {
      throw new SiteError('shape', 'The houses data is not an object');
    }

    const result: Record<string, HouseInfo> = {};
    for (const [house, raw] of Object.entries(data)) {
      result[house] = parseHouse(house, raw);
    }
    return result;
  }
}

export async function retrying<T>(
  attempt: () => Promise<T>,
  options: { delaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const delaysMs = options.delaysMs ?? [2000, 10000, 30000];
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      const isRetryable =
        e instanceof SiteError && (e.kind === 'server' || e.kind === 'network');
      if (isRetryable && i < delaysMs.length) {
        await sleep(delaysMs[i]);
      } else {
        throw e;
      }
    }
  }
}
