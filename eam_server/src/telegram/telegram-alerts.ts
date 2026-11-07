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
import {
  bmsAlerts,
  cellLowAlerts,
  inverterAlerts,
  type CellLowLimits,
  type CellLowState,
  type InverterAlertState,
} from './alerts';
import type { BmsReading } from '../bms/reading';
import { TelegramBot } from './telegram-bot';
import { NotificationSettingsService } from '../notifications/notification-settings.service';
import { sendsToTelegram } from '../notifications/notification-settings';
import {
  BMS_SOC_FRESH_MS,
  CELL_LOW_HOLD_MS,
  CELL_LOW_RECOVER_V,
  DEFAULT_CELL_LOW_V,
  DEFAULT_LOW_SOC,
  OFFLINE_AFTER_MS,
} from './constants';

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
  /** Per BMS device: its inverter and name, looked up once. */
  private readonly bmsDevices = new Map<
    number,
    { profileId: number; name: string }
  >();
  /** Per inverter: the BMS's latest charge, and which BMS. */
  private readonly bmsSoc = new Map<
    number,
    { soc: number; atMs: number; name: string }
  >();
  private readonly cellLow = new Map<number, CellLowState>();
  private readonly cellLimits: CellLowLimits;
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
    const cellLowV = Number(config.get<string>('BMS_CELL_LOW_V'));
    this.cellLimits = {
      thresholdV: cellLowV > 0 ? cellLowV : DEFAULT_CELL_LOW_V,
      holdMs: CELL_LOW_HOLD_MS,
      recoverV: CELL_LOW_RECOVER_V,
    };
  }

  async onReading(
    profileId: number,
    reading: Record<string, number>,
  ): Promise<void> {
    const bms = this.bmsSoc.get(profileId);
    const fresh = bms && Date.now() - bms.atMs <= BMS_SOC_FRESH_MS ? bms : null;
    const { state, messages } = inverterAlerts(
      this.inverterState.get(profileId),
      reading,
      this.lowSoc,
      fresh?.soc,
    );
    this.inverterState.set(profileId, state);
    for (const message of messages)
      await this.toHousehold(
        profileId,
        message,
        message.key === 'batteryLow' ? fresh?.name : undefined,
      );
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

  /**
   * A BMS reading: its alarms, its charge for the inverter's low-battery
   * alert, and a cell sagging under the limit while the grid is down.
   */
  async onBmsReading(
    deviceId: number,
    reading: Partial<BmsReading>,
    now = new Date(),
  ): Promise<void> {
    const device = await this.bmsDevice(deviceId);
    if (!device) return;
    const { state, messages } = bmsAlerts(
      this.bmsState.get(deviceId),
      reading.alarms ?? [],
    );
    this.bmsState.set(deviceId, state);

    if (typeof reading.stateOfChargePct === 'number')
      this.bmsSoc.set(device.profileId, {
        soc: reading.stateOfChargePct,
        atMs: now.getTime(),
        name: device.name,
      });

    const cell = cellLowAlerts(
      this.cellLow.get(deviceId),
      {
        atMs: now.getTime(),
        gridUp: this.inverterState.get(device.profileId)?.gridUp,
        cellMinV: reading.cellMinV ?? null,
        cellMinIndex: reading.cellMinIndex ?? null,
        packVoltageV: reading.packVoltageV ?? null,
        currentA: reading.currentA ?? null,
        stateOfChargePct: reading.stateOfChargePct ?? null,
      },
      this.cellLimits,
    );
    this.cellLow.set(deviceId, cell.state);

    for (const message of [...messages, ...cell.messages])
      await this.toHousehold(device.profileId, message, device.name);
  }

  private async bmsDevice(
    deviceId: number,
  ): Promise<{ profileId: number; name: string } | null> {
    const known = this.bmsDevices.get(deviceId);
    if (known) return known;
    const row = await this.prisma.bmsDevice.findUnique({
      where: { id: deviceId },
      select: { name: true, inverterProfileId: true },
    });
    if (!row) return null;
    const device = { profileId: row.inverterProfileId, name: row.name };
    this.bmsDevices.set(deviceId, device);
    return device;
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
