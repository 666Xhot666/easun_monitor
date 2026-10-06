import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TELEGRAM_CLIENT,
  type TelegramClient,
  type TelegramUpdate,
} from './telegram-client';
import { TelegramLinksService } from './telegram-links.service';

const POLL_TIMEOUT_SECONDS = 30;
const RETRY_AFTER_ERROR_MS = 5_000;

const HOW_TO_LINK =
  'To link this chat, open Settings > Telegram in the app, get a code, and send it here as /start <code>.';
const HELP = 'Commands: /status, /energy, /stop (unlink this chat).';

/**
 * The Telegram bot: long-polls for messages (no public address needed) and
 * answers them. Runs only when TELEGRAM_BOT_TOKEN is set.
 */
@Injectable()
export class TelegramBot
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramBot.name);
  private running = false;

  constructor(
    @Inject(TELEGRAM_CLIENT) private readonly client: TelegramClient | null,
    private readonly links: TelegramLinksService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.client || !this.config.get<string>('TELEGRAM_BOT_TOKEN')) return;
    this.running = true;
    void this.poll();
  }

  onApplicationShutdown(): void {
    this.running = false;
  }

  /** Sends a message to a chat; failures are logged, never thrown. */
  async send(chatId: string, text: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.sendMessage(chatId, text);
    } catch (error) {
      this.logger.warn(
        `Sending to chat ${chatId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const text = update.message?.text?.trim();
    const id = update.message?.chat.id;
    if (!text || id === undefined) return;
    const chatId = String(id);
    const [command, argument] = text.split(/\s+/, 2);

    if (command === '/start' && argument) {
      const linked = await this.links.linkChat(argument, chatId);
      await this.send(
        chatId,
        linked
          ? `Linked to ${linked.email}. Alerts and the evening summary will come here. ${HELP}`
          : `This code is not valid; codes expire after 10 minutes. ${HOW_TO_LINK}`,
      );
      return;
    }
    if (command === '/stop') {
      await this.links.unlinkChat(chatId);
      await this.send(chatId, `This chat is unlinked. ${HOW_TO_LINK}`);
      return;
    }
    const userId = await this.links.userForChat(chatId);
    await this.send(chatId, userId === null ? HOW_TO_LINK : HELP);
  }

  private async poll(): Promise<void> {
    let offset = 0;
    while (this.running && this.client) {
      try {
        const updates = await this.client.getUpdates(
          offset,
          POLL_TIMEOUT_SECONDS,
        );
        for (const update of updates) {
          offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        this.logger.warn(
          `Telegram polling failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_AFTER_ERROR_MS),
        );
      }
    }
  }
}
