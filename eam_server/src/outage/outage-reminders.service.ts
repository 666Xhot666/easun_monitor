import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationSettingsService } from '../notifications/notification-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramAlerts } from '../telegram/telegram-alerts';
import { TelemetryStore } from '../telemetry/telemetry.store';
import type { ForecastWindow } from './forecast';
import { OutageForecastService } from './outage-forecast.service';
import { reminderMessage, remindersDue, type Member } from './reminders';
import { SOC_FRESH_MS } from './constants';
import { SMG_II_READINGS } from '../inverter/readings/smg-ii.readings';

const DAY_MS = 24 * 60 * 60_000;

/**
 * "Outage in 15 min": each household member is reminded their own lead time
 * before an outage starts, once. What was sent is kept in memory: after a
 * restart the first round is a silent baseline.
 */
@Injectable()
export class OutageReminders {
  private readonly logger = new Logger(OutageReminders.name);
  /** Reminders sent, per window and user, with the window's start (ms). */
  private readonly sent = new Map<string, number>();
  /** Windows recorded for the Alerts page, with their start (ms). */
  private readonly recorded = new Map<string, number>();
  private started = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly forecasts: OutageForecastService,
    private readonly alerts: TelegramAlerts,
    private readonly notifications: NotificationSettingsService,
    private readonly telemetry: TelemetryStore,
  ) {}

  @Interval(60_000)
  async tick(now = new Date()): Promise<void> {
    const baseline = !this.started;
    this.started = true;
    try {
      const sources = await this.prisma.outageSource.findMany({
        where: { enabled: true, houseState: 'FOUND' },
        select: {
          inverterProfileId: true,
          inverterProfile: { select: { householdId: true } },
        },
      });
      for (const source of sources) {
        await this.remind(
          source.inverterProfileId,
          source.inverterProfile.householdId,
          now,
          baseline,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Outage reminders failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.forget(now);
  }

  private async remind(
    profileId: number,
    householdId: number,
    now: Date,
    baseline: boolean,
  ): Promise<void> {
    const userIds = (
      await this.prisma.membership.findMany({
        where: { householdId },
        select: { userId: true },
      })
    ).map((m) => m.userId);
    if (userIds.length === 0) return;
    const settings = await this.notifications.forUsers(userIds);
    const members: Member[] = userIds.map((userId) => ({
      userId,
      leadMinutes: settings.get(userId)!.outageLeadMinutes,
      possible: settings.get(userId)!.possibleOutages,
    }));
    const lead = Math.max(...members.map((m) => m.leadMinutes));
    const forecast = await this.forecasts.getOutageForecast(
      profileId,
      now,
      new Date(now.getTime() + (lead + 1) * 60_000),
      now,
    );

    const byWindow = new Map<
      string,
      { window: ForecastWindow; userIds: number[] }
    >();
    for (const { window, userId } of remindersDue(
      forecast.windows,
      members,
      now,
    )) {
      const key = windowKey(profileId, window);
      if (this.sent.has(`${key}|${userId}`)) continue;
      this.sent.set(`${key}|${userId}`, window.start.getTime());
      const entry = byWindow.get(key) ?? { window, userIds: [] };
      entry.userIds.push(userId);
      byWindow.set(key, entry);
    }
    if (byWindow.size === 0) return;
    if (baseline) {
      for (const [key, { window }] of byWindow) {
        this.recorded.set(key, window.start.getTime());
      }
      return;
    }

    const soc = await this.batteryLevel(profileId, now);
    const staleHours =
      forecast.state === 'stale' && forecast.lastOkAt
        ? Math.floor((now.getTime() - forecast.lastOkAt.getTime()) / 3_600_000)
        : null;
    for (const [key, { window, userIds: due }] of byWindow) {
      const message = reminderMessage(window, now, { soc, staleHours });
      if (!this.recorded.has(key)) {
        this.recorded.set(key, window.start.getTime());
        await this.alerts.record(profileId, message);
      }
      await this.alerts.toChats(profileId, message, { userIds: due });
    }
  }

  private async batteryLevel(
    profileId: number,
    now: Date,
  ): Promise<number | null> {
    const latest = await this.telemetry.latest(profileId);
    if (!latest || now.getTime() - latest.timestamp.getTime() > SOC_FRESH_MS) {
      return null;
    }
    const { batterySoc } = SMG_II_READINGS.common(
      latest.payload as Record<string, number>,
    );
    return batterySoc ?? null;
  }

  /** Drops what is about windows that started over a day ago. */
  private forget(now: Date): void {
    for (const map of [this.sent, this.recorded]) {
      for (const [key, start] of map) {
        if (start < now.getTime() - DAY_MS) map.delete(key);
      }
    }
  }
}

const windowKey = (profileId: number, w: ForecastWindow) =>
  `${profileId}|${w.source}|${w.status}|${w.start.getTime()}`;
