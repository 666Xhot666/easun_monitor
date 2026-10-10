import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type NotificationSettings,
} from './notification-settings';

/** Reads and saves users' notification settings, defaults filled in. */
@Injectable()
export class NotificationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: number): Promise<NotificationSettings> {
    const row = await this.prisma.notificationSettings.findUnique({
      where: { userId },
    });
    return mergeSettings(DEFAULT_SETTINGS, row?.settings ?? {});
  }

  /** Settings for several users at once; users without a row get the defaults. */
  async forUsers(
    userIds: number[],
  ): Promise<Map<number, NotificationSettings>> {
    const rows = await this.prisma.notificationSettings.findMany({
      where: { userId: { in: userIds } },
    });
    const byUser = new Map(rows.map((r) => [r.userId, r.settings]));
    return new Map(
      userIds.map((id) => [
        id,
        mergeSettings(DEFAULT_SETTINGS, byUser.get(id) ?? {}),
      ]),
    );
  }

  async update(userId: number, patch: unknown): Promise<NotificationSettings> {
    const settings = mergeSettings(await this.get(userId), patch);
    const json = settings as unknown as Prisma.InputJsonValue;
    await this.prisma.notificationSettings.upsert({
      where: { userId },
      create: { userId, settings: json },
      update: { settings: json },
    });
    return settings;
  }
}
