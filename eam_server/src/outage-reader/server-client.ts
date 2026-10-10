export interface ReaderSource {
  site: string;
  city: string;
  street: string;
  house: string;
  enabled: boolean;
}

export class ServerError extends Error {
  constructor(
    message: string,
    readonly unauthorized: boolean,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

export interface ReaderServerOptions {
  url: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class ReaderServerClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: ReaderServerOptions) {
    this.base = options.url.replace(/\/+$/, '');
    this.token = options.token;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = this.base + path;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };

    let bodyText: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyText = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: bodyText,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new ServerError(`Server unreachable: ${message}`, false);
    }

    if (!response.ok) {
      const text = await response.text();
      let detail: string;
      try {
        const parsed = JSON.parse(text);
        const msg = parsed.message;
        if (Array.isArray(msg)) {
          detail = msg.join('; ');
        } else if (typeof msg === 'string') {
          detail = msg;
        } else {
          detail = text;
        }
      } catch {
        detail = text;
      }
      throw new ServerError(
        `Server answered ${response.status}: ${detail}`,
        response.status === 401,
      );
    }

    const text = await response.text();
    if (text === '') {
      return null;
    }
    return JSON.parse(text);
  }

  async source(): Promise<ReaderSource> {
    return (await this.call(
      'GET',
      '/api/outage/reader/source',
    )) as ReaderSource;
  }

  async putStreets(streets: Record<string, string[]>): Promise<void> {
    await this.call('PUT', '/api/outage/reader/streets', {
      site: 'dnem',
      streets,
    });
  }

  async postCheck(check: object): Promise<void> {
    await this.call('POST', '/api/outage/reader/checks', check);
  }
}
