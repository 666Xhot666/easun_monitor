import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SettingsSnapshotRow {
  readAt: Date;
  lastSeenAt: Date;
  reason: string;
  changes: Record<string, number> | null;
  values: Record<string, number>;
}

function sameValues(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }

    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
}

/**
 * The history of an inverter's settings registers, as read from the device.
 * A row is added only when some value differs from the latest snapshot (or
 * when the read follows a write by the app); an identical read just moves
 * the latest row's lastSeenAt on.
 */
@Injectable()
export class SettingsHistory {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    profileId: number,
    values: Record<string, number>,
    at: Date,
    written?: Record<string, number>,
  ): Promise<void> {
    const latest = await this.prisma.inverterSettingsSnapshot.findFirst({
      where: { inverterProfileId: profileId },
      orderBy: { readAt: 'desc' },
    });

    if (!written && latest && sameValues(latest.values as Record<string, number>, values)) {
      await this.prisma.inverterSettingsSnapshot.update({
        where: { id: latest.id },
        data: { lastSeenAt: at },
      });
      return;
    }

    await this.prisma.inverterSettingsSnapshot.create({
      data: {
        inverterProfileId: profileId,
        readAt: at,
        lastSeenAt: at,
        values,
        reason: written ? 'write' : 'read',
        changes: written ?? Prisma.JsonNull,
      },
    });
  }

  async list(
    profileId: number,
    range: { from?: Date; to?: Date; limit?: number } = {},
  ): Promise<SettingsSnapshotRow[]> {
    const rows = await this.prisma.inverterSettingsSnapshot.findMany({
      where: {
        inverterProfileId: profileId,
        readAt: {
          ...(range.from ? { gte: range.from } : {}),
          ...(range.to ? { lte: range.to } : {}),
        },
      },
      orderBy: { readAt: 'desc' },
      take: Math.min(range.limit ?? 1000, 1000),
    });

    return rows.map((row) => ({
      readAt: row.readAt,
      lastSeenAt: row.lastSeenAt,
      reason: row.reason,
      changes: (row.changes as Record<string, number> | null) ?? null,
      values: row.values as Record<string, number>,
    }));
  }
}
