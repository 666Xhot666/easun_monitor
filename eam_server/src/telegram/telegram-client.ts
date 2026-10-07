/** Injection token for the Telegram client; null when no bot token is set. */
export const TELEGRAM_CLIENT = Symbol('TELEGRAM_CLIENT');

/** One incoming update, as much of it as the bot uses. */
export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  /** A press on an inline button. */
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

/** An inline button; `data` comes back in the callback when pressed. */
export interface InlineButton {
  text: string;
  data: string;
}

export interface MessageOptions {
  /** The text is Telegram HTML. */
  html?: boolean;
  /** Inline buttons, row by row. */
  buttons?: InlineButton[][];
}

/** An entry of the "/" command menu. */
export interface BotCommand {
  command: string;
  description: string;
}

/** The Telegram Bot API calls the bot makes. */
export interface TelegramClient {
  /** Long poll: waits up to `timeoutSeconds` for updates after `offset`. */
  getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]>;
  sendMessage(
    chatId: string,
    text: string,
    options?: MessageOptions,
  ): Promise<void>;
  editMessage(
    chatId: string,
    messageId: number,
    text: string,
    options?: MessageOptions,
  ): Promise<void>;
  /** Stops the button's loading spinner. */
  answerCallback(callbackId: string): Promise<void>;
  sendPhoto(
    chatId: string,
    png: Buffer,
    caption?: string,
    options?: MessageOptions,
  ): Promise<void>;
  setCommands(commands: BotCommand[]): Promise<void>;
}

const messageFields = (options?: MessageOptions) => ({
  ...(options?.html ? { parse_mode: 'HTML' } : {}),
  ...(options?.buttons
    ? {
        reply_markup: {
          inline_keyboard: options.buttons.map((row) =>
            row.map((b) => ({ text: b.text, callback_data: b.data })),
          ),
        },
      }
    : {}),
});

/** The Bot API over HTTPS. */
export class HttpTelegramClient implements TelegramClient {
  constructor(private readonly token: string) {}

  getUpdates(
    offset: number,
    timeoutSeconds: number,
  ): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'callback_query'],
    });
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: MessageOptions,
  ): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      ...messageFields(options),
    });
  }

  async editMessage(
    chatId: string,
    messageId: number,
    text: string,
    options?: MessageOptions,
  ): Promise<void> {
    try {
      await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...messageFields(options),
      });
    } catch (error) {
      // A refresh with nothing new: the message already shows it.
      if (
        error instanceof Error &&
        error.message.includes('message is not modified')
      )
        return;
      throw error;
    }
  }

  async answerCallback(callbackId: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackId });
  }

  async sendPhoto(
    chatId: string,
    png: Buffer,
    caption?: string,
    options?: MessageOptions,
  ): Promise<void> {
    const form = new FormData();
    form.append('chat_id', chatId);
    if (caption) form.append('caption', caption);
    for (const [key, value] of Object.entries(messageFields(options))) {
      form.append(
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      );
    }
    form.append(
      'photo',
      new Blob([new Uint8Array(png)], { type: 'image/png' }),
      'chart.png',
    );
    await this.request('sendPhoto', { method: 'POST', body: form });
  }

  async setCommands(commands: BotCommand[]): Promise<void> {
    await this.call('setMyCommands', { commands });
  }

  private call<T>(method: string, body: object): Promise<T> {
    return this.request<T>(method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(method: string, init: RequestInit): Promise<T> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      init,
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
