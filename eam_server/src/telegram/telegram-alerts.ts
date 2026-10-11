import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  alertKindOf,
  alertText,
  type AlertMessage,
} from '../alerts/alert-message';
import { languageOr, type Language } from '../i18n/languages';
import { bmsAlerts, inverterAlerts, type InverterAlertState } from './alerts';
import { TelegramBot } from './telegram-bot';
import { NotificationSettingsService } from '../notifications/notification-settings.service';
import { sendsToTelegram } from '../notifications/notification-settings';

/** How long a logger or BMS reader is silent before it is reported. */
const OFFLINE_AFTER_MS = 5 * 60_000;
const DEFAULT_LOW_SOC = 20;

/**
 * Alerts on change, recorded for the Alerts page and sent to the linked
 * chats of every member of the inverter's household. State is in memory:
 * after a restart the first reading is a silent baseline.
 */
@Injectable()
export class TelegramAlerts {
  private readonly logger = new Logger(TelegramAlerts.name);
  private readonly lowSoc: number;
  private readonly inverterState = new Map<number, InverterAlertState>();
  private readonly bmsState = new Map<number, string[]>();
  /** Loggers that are down: since when, and whether that was reported. */
  private readonly loggerDown = new Map<
    number,
    { since: number; reported: boolean }
  >();
  /** BMS devices reported silent, and their last reading before that (ms). */
  private readonly bmsOffline = new Map<number, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBot,
    private readonly notifications: NotificationSettingsService,
    config: ConfigService,
  ) {
    const configured = Number(config.get<string>('TELEGRAM_LOW_SOC'));
    this.lowSoc = configured > 0 ? configured : DEFAULT_LOW_SOC;
  }

  async onReading(
    profileId: number,
    reading: Record<string, number>,
  ): Promise<void> {
    const { state, messages } = inverterAlerts(
      this.inverterState.get(profileId),
      reading,
      this.lowSoc,
    );
    this.inverterState.set(profileId, state);
    for (const message of messages) await this.toHousehold(profileId, message);
  }

  /** The logger answered (up) or not (down). */
  async onLogger(
    profileId: number,
    up: boolean,
    now = new Date(),
  ): Promise<void> {
    const down = this.loggerDown.get(profileId);
    if (!up) {
      if (!down)
        this.loggerDown.set(profileId, {
          since: now.getTime(),
          reported: false,
        });
      return;
    }
    if (!down) return;
    this.loggerDown.delete(profileId);
    if (down.reported) {
      await this.toHousehold(profileId, {
        key: 'loggerBack',
        params: { downMs: now.getTime() - down.since },
      });
    }
  }

  async onBmsReading(deviceId: number, alarms: string[]): Promise<void> {
    const { state, messages } = bmsAlerts(this.bmsState.get(deviceId), alarms);
    this.bmsState.set(deviceId, state);
    if (messages.length === 0) return;
    const device = await this.prisma.bmsDevice.findUnique({
      where: { id: deviceId },
      select: { name: true, inverterProfileId: true },
    });
    if (!device) return;
    for (const message of messages)
      await this.toHousehold(device.inverterProfileId, message, device.name);
  }

  @Interval(60_000)
  async checkOffline(now = new Date()): Promise<void> {
    try {
      for (const [profileId, down] of this.loggerDown) {
        if (!down.reported && now.getTime() - down.since >= OFFLINE_AFTER_MS) {
          down.reported = true;
          await this.toHousehold(profileId, {
            key: 'loggerDown',
            params: { sinceAt: new Date(down.since).toISOString() },
          });
        }
      }
      const devices = await this.prisma.bmsDevice.findMany({
        where: { lastSeenAt: { not: null } },
        select: {
          id: true,
          name: true,
          inverterProfileId: true,
          lastSeenAt: true,
        },
      });
      for (const device of devices) {
        const lastSeen = device.lastSeenAt!.getTime();
        const silent = now.getTime() - lastSeen >= OFFLINE_AFTER_MS;
        const silentSince = this.bmsOffline.get(device.id);
        if (silent && silentSince === undefined) {
          this.bmsOffline.set(device.id, lastSeen);
          await this.toHousehold(
            device.inverterProfileId,
            {
              key: 'bmsSilent',
              params: { sinceAt: device.lastSeenAt!.toISOString() },
            },
            device.name,
          );
        } else if (!silent && silentSince !== undefined) {
          this.bmsOffline.delete(device.id);
          await this.toHousehold(
            device.inverterProfileId,
            { key: 'bmsBack', params: { silentMs: lastSeen - silentSince } },
            device.name,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Offline check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Records the alert for the Alerts page and sends it to the linked chats of
   * the household's members who want its kind on Telegram.
   */
  async toHousehold(
    profileId: number,
    message: AlertMessage,
    bmsName?: string,
  ): Promise<void> {
    if (await this.record(profileId, message, bmsName)) {
      await this.toChats(profileId, message, { bmsName });
    }
  }

  /** Keeps the alert for the Alerts page; false if the inverter is gone. */
  async record(
    profileId: number,
    message: AlertMessage,
    bmsName?: string,
  ): Promise<boolean> {
    const exists = await this.prisma.inverterProfile.count({
      where: { id: profileId },
    });
    if (exists === 0) return false;
    // Kept for the Alerts page whether or not anyone has linked Telegram.
    await this.prisma.alertEvent.create({
      data: {
        inverterProfileId: profileId,
        kind: alertKindOf(message.key),
        text: this.word(message, 'en'),
        key: message.key,
        params: message.params as Prisma.InputJsonValue | undefined,
        source: bmsName ?? null,
      },
    });
    return true;
  }

  /**
   * Sends the alert to the linked chats of the household's members (or only
   * `userIds`) who want its kind on Telegram.
   */
  async toChats(
    profileId: number,
    message: AlertMessage,
    options: { bmsName?: string; userIds?: number[] } = {},
  ): Promise<void> {
    const profile = await this.prisma.inverterProfile.findUnique({
      where: { id: profileId },
      select: { name: true, householdId: true },
    });
    if (!profile) return;
    const links = await this.prisma.telegramLink.findMany({
      where: {
        user: { memberships: { some: { householdId: profile.householdId } } },
        ...(options.userIds && { userId: { in: options.userIds } }),
      },
      orderBy: { userId: 'asc' },
      select: {
        chatId: true,
        userId: true,
        user: { select: { language: true } },
      },
    });
    const settings = await this.notifications.forUsers(
      links.map((l) => l.userId),
    );
    const kind = alertKindOf(message.key);
    const now = new Date();
    const { bmsName } = options;
    const from = `${profile.name}${bmsName ? ` (${bmsName})` : ''}`;
    for (const { chatId, userId, user } of links) {
      if (
        sendsToTelegram(settings.get(userId)!, kind, now, this.bot.timeZone)
      ) {
        const text = this.word(message, languageOr(user.language));
        await this.bot.send(chatId, `${from}: ${text}`);
      }
    }
  }

  /** A recorded alert in `language`, for the Alerts page. */
  wordRecorded(
    alert: { text: string; key: string | null; params: unknown },
    language: Language,
  ): string {
    if (alert.key === null) return alert.text;
    const params = (alert.params ?? undefined) as AlertMessage['params'];
    return this.word({ key: alert.key, params }, language);
  }

  /** The alert in `language`. */
  private word(message: AlertMessage, language: Language): string {
    return alertText(message, language, this.bot.timeZone);
  }
}
