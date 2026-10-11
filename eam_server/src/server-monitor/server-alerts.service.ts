import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationSettingsService } from '../notifications/notification-settings.service';
import { sendsToTelegram } from '../notifications/notification-settings';
import { PrismaService } from '../prisma/prisma.service';
import type { HostSample } from '../server-agent/sample';
import { clockTime, duration } from '../telegram/messages';
import { TelegramBot } from '../telegram/telegram-bot';
import {
  serverAlerts,
  type AlertState,
  type AlertThresholds,
  type ServerNotice,
} from './server-alerts';
import { ServerAccessService } from './server-access.service';

export const DEFAULT_LIMITS: AlertThresholds = {
  heatC: 90,
  storageFreePercent: 10,
  memoryUsedPercent: 90,
};

/** The agent counts as silent after this long without a sample. */
const SILENT_AFTER_MS = 5 * 60_000;
const RECENT_EVENTS = 30;

const LIMITS: Record<keyof AlertThresholds, [number, number]> = {
  heatC: [40, 110],
  storageFreePercent: [1, 50],
  memoryUsedPercent: [50, 99],
};

/** The owner's limits, checked: whole numbers in a sensible range. */
export function parseLimits(body: unknown): AlertThresholds {
  const o = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const limits = {} as AlertThresholds;
  for (const [key, [min, max]] of Object.entries(LIMITS) as Array<
    [keyof AlertThresholds, [number, number]]
  >) {
    const v = o[key];
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
      throw new BadRequestException(
        `${key} must be a whole number from ${min} to ${max}`,
      );
    }
    limits[key] = v as number;
  }
  return limits;
}

/**
 * Server notices: overheating, storage, memory and updates from each sample,
 * and a silent agent. Sent to the owner and viewers who want each kind on
 * Telegram, and kept for the Server page. State is in memory: after a
 * restart the first sample, and the first silence check, are a baseline.
 */
@Injectable()
export class ServerAlertsService {
  private readonly logger = new Logger(ServerAlertsService.name);
  private state: AlertState | undefined;
  /** The last sample's time before the agent went silent. */
  private silentSince: number | null = null;
  /** Whether that silence was reported (not at the baseline). */
  private silentReported = false;
  private checkedSilence = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ServerAccessService,
    private readonly bot: TelegramBot,
    private readonly notifications: NotificationSettingsService,
  ) {}

  async limits(): Promise<AlertThresholds> {
    const row = await this.prisma.serverAlertSettings.findUnique({
      where: { id: 1 },
    });
    if (!row) return DEFAULT_LIMITS;
    const { heatC, storageFreePercent, memoryUsedPercent } = row;
    return { heatC, storageFreePercent, memoryUsedPercent };
  }

  /** The limits and the recent notices, for the owner and viewers. */
  async get(userId: number) {
    await this.access.requireViewer(userId);
    const [limits, events] = await Promise.all([
      this.limits(),
      this.prisma.serverAlertEvent.findMany({
        orderBy: { at: 'desc' },
        take: RECENT_EVENTS,
      }),
    ]);
    return { limits, events };
  }

  async putLimits(ownerId: number, body: unknown): Promise<AlertThresholds> {
    await this.access.requireOwner(ownerId);
    const limits = parseLimits(body);
    await this.prisma.serverAlertSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...limits },
      update: limits,
    });
    return limits;
  }

  /** A new sample from the agent. */
  async onSample(sample: HostSample): Promise<void> {
    try {
      if (this.silentSince !== null) {
        const since = this.silentSince;
        const reported = this.silentReported;
        this.silentSince = null;
        this.silentReported = false;
        if (reported)
          await this.send({
            kind: 'server-agent',
            text: `Server: agent back after ${duration(Date.parse(sample.at) - since)}`,
          });
      }
      const { state, notices } = serverAlerts(
        this.state,
        sample,
        await this.limits(),
      );
      this.state = state;
      for (const notice of notices) await this.send(notice);
    } catch (e) {
      this.logger.warn(
        `Server notices failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Whether the agent has gone silent. */
  @Interval(60_000)
  async checkSilent(now = new Date()): Promise<void> {
    const baseline = !this.checkedSilence;
    this.checkedSilence = true;
    try {
      const latest = await this.prisma.serverSample.findFirst({
        orderBy: { at: 'desc' },
        select: { at: true },
      });
      if (!latest || this.silentSince !== null) return;
      if (now.getTime() - latest.at.getTime() < SILENT_AFTER_MS) return;
      this.silentSince = latest.at.getTime();
      if (baseline) return;
      this.silentReported = true;
      await this.send({
        kind: 'server-agent',
        text: `Server: agent silent since ${clockTime(latest.at, this.bot.timeZone)}`,
      });
    } catch (e) {
      this.logger.warn(
        `Agent silence check failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async send(notice: ServerNotice): Promise<void> {
    await this.prisma.serverAlertEvent.create({ data: notice });
    const links = await this.prisma.telegramLink.findMany({
      where: {
        user: {
          OR: [{ serverViewer: true }, { serverOwner: { isNot: null } }],
        },
      },
      orderBy: { userId: 'asc' },
      select: { chatId: true, userId: true },
    });
    const settings = await this.notifications.forUsers(
      links.map((l) => l.userId),
    );
    const now = new Date();
    for (const { chatId, userId } of links) {
      if (
        sendsToTelegram(
          settings.get(userId)!,
          notice.kind,
          now,
          this.bot.timeZone,
        )
      ) {
        await this.bot.send(chatId, notice.text);
      }
    }
  }
}
