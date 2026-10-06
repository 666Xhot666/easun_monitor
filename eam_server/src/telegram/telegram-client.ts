/** Injection token for the Telegram client; null when no bot token is set. */
export const TELEGRAM_CLIENT = Symbol('TELEGRAM_CLIENT');

/** One incoming update, as much of it as the bot uses. */
export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

/** The Telegram Bot API calls the bot makes. */
export interface TelegramClient {
  /** Long poll: waits up to `timeoutSeconds` for updates after `offset`. */
  getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]>;
  sendMessage(chatId: string, text: string): Promise<void>;
}

/** The Bot API over HTTPS. */
export class HttpTelegramClient implements TelegramClient {
  constructor(private readonly token: string) {}

  async getUpdates(
    offset: number,
    timeoutSeconds: number,
  ): Promise<TelegramUpdate[]> {
    const result = await this.call<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ['message'],
    });
    return result;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text });
  }

  private async call<T>(method: string, body: object): Promise<T> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const json = (await response.json()) as {
      ok: boolean;
      result: T;
      description?: string;
    };
    // The token is part of the URL: never put the URL in an error.
    if (!json.ok)
      throw new Error(
        `Telegram ${method} failed: ${json.description ?? response.status}`,
      );
    return json.result;
  }
}
