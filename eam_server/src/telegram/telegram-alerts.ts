import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { RegisterMap } from '../inverter/registers/register-map';
import { SMG_II_REGISTERS } from '../inverter/registers/smg-ii.registers';
import { PrismaService } from '../prisma/prisma.service';
import { clockTime, duration } from './messages';
import { bmsAlerts, inverterAlerts, type InverterAlertState } from './alerts';
import { TelegramBot } from './telegram-bot';

/** How long a logger or BMS reader is silent before it is reported. */
const OFFLINE_AFTER_MS = 5 * 60_000;
const DEFAULT_LOW_SOC = 20;

/**
 * Alerts on change, sent to the linked chats of every member of the
 * inverter's household. State is in memory: after a restart the first
 * reading is a silent baseline.
 */
@Injectable()
export class TelegramAlerts {
  private readonly logger = new Logger(TelegramAlerts.name);
  private readonly map = new RegisterMap(SMG_II_REGISTERS);
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
      this.map,
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
      await this.toHousehold(
        profileId,
        `Logger back online after ${duration(now.getTime() - down.since)}`,
      );
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
          await this.toHousehold(
            profileId,
            `Logger not answering since ${clockTime(new Date(down.since), this.bot.timeZone)}`,
          );
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
            `BMS reader silent since ${clockTime(device.lastSeenAt!, this.bot.timeZone)}`,
            device.name,
          );
        } else if (!silent && silentSince !== undefined) {
          this.bmsOffline.delete(device.id);
          await this.toHousehold(
            device.inverterProfileId,
            `BMS reader back online after ${duration(lastSeen - silentSince)}`,
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

  private async toHousehold(
    profileId: number,
    message: string,
    bmsName?: string,
  ): Promise<void> {
    const profile = await this.prisma.inverterProfile.findUnique({
      where: { id: profileId },
      select: { name: true, householdId: true },
    });
    if (!profile) return;
    const links = await this.prisma.telegramLink.findMany({
      where: {
        user: { memberships: { some: { householdId: profile.householdId } } },
      },
      orderBy: { userId: 'asc' },
      select: { chatId: true },
    });
    const text = `${profile.name}${bmsName ? ` (${bmsName})` : ''}: ${message}`;
    for (const { chatId } of links) await this.bot.send(chatId, text);
  }
}
