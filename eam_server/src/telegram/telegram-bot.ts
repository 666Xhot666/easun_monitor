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
import { HouseholdsService } from '../households/households.service';
import { RegisterMap } from '../inverter/registers/register-map';
import { SMG_II_REGISTERS } from '../inverter/registers/smg-ii.registers';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryStore } from '../telemetry/telemetry.store';
import { dayStart, formatEnergy, formatStatus } from './messages';

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
  private readonly map = new RegisterMap(SMG_II_REGISTERS);

  constructor(
    @Inject(TELEGRAM_CLIENT) private readonly client: TelegramClient | null,
    private readonly links: TelegramLinksService,
    private readonly config: ConfigService,
    private readonly households: HouseholdsService,
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryStore,
  ) {}

  /** The IANA time zone that defines "today" (TIME_ZONE, default UTC). */
  get timeZone(): string {
    return this.config.get<string>('TIME_ZONE') || 'UTC';
  }

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
    if (userId === null) {
      await this.send(chatId, HOW_TO_LINK);
    } else if (command === '/status') {
      await this.send(chatId, await this.status(userId));
    } else if (command === '/energy') {
      await this.send(chatId, await this.energy(userId));
    } else {
      await this.send(chatId, HELP);
    }
  }

  /** The inverters of all the user's households. */
  private async profilesOf(userId: number) {
    return this.prisma.inverterProfile.findMany({
      where: {
        householdId: { in: await this.households.householdIds(userId) },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  private async status(userId: number): Promise<string> {
    const profiles = await this.profilesOf(userId);
    if (profiles.length === 0) return 'No inverters in your households yet.';
    const now = new Date();
    const parts = await Promise.all(
      profiles.map(async (p) => {
        const latest = await this.telemetry.latest(p.id);
        return formatStatus(
          p.name,
          this.map,
          latest
            ? {
                timestamp: latest.timestamp,
                payload: latest.payload as Record<string, number>,
              }
            : null,
          now,
        );
      }),
    );
    return parts.join('\n\n');
  }

  private async energy(userId: number): Promise<string> {
    const profiles = await this.profilesOf(userId);
    if (profiles.length === 0) return 'No inverters in your households yet.';
    const from = dayStart(new Date(), this.timeZone);
    const to = new Date(from.getTime() + 24 * 3_600_000);
    const parts = await Promise.all(
      profiles.map(async (p) =>
        formatEnergy(p.name, await this.telemetry.energy(p.id, { from, to })),
      ),
    );
    return parts.join('\n');
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
