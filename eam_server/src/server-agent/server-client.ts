import type { HostSample } from './sample';

export class ServerError extends Error {
  constructor(
    message: string,
    readonly unauthorized: boolean,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

export interface AgentServerOptions {
  url: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * Sends the agent's samples to the server.
 */
export class AgentServerClient {
  private base: string;
  private token: string;
  private fetch: typeof globalThis.fetch;
  private timeoutMs: number;

  constructor(options: AgentServerOptions) {
    this.base = options.url.replace(/\/+$/, '');
    this.token = options.token;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async postSample(sample: HostSample): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(`${this.base}/api/server/agent/samples`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sample),
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
        if (Array.isArray(parsed.message)) {
          detail = parsed.message.join('; ');
        } else if (typeof parsed.message === 'string') {
          detail = parsed.message;
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
}
