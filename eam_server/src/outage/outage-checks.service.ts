import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { hashIngestToken } from '../bms/ingest-token';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseOkCheck, type OkCheck } from './check-payload';
import type { PostOutageCheckDto } from './dto/post-outage-check.dto';

type Tx = Prisma.TransactionClient;

/**
 * Stores the reader's checks: every check in the log, and from a successful
 * one the house's groups, its weekly pattern (a new version only when it
 * changes) and its confirmed days (the latest version of each).
 */
@Injectable()
export class OutageChecksService {
  constructor(private readonly prisma: PrismaService) {}

  async sourceIdForToken(token: string): Promise<number | null> {
    const source = await this.prisma.outageSource.findUnique({
      where: { tokenHash: hashIngestToken(token) },
      select: { id: true },
    });
    return source?.id ?? null;
  }

  /** Stores a check; a re-sent one (same time) is stored once. */
  async ingest(
    sourceId: number,
    dto: PostOutageCheckDto,
  ): Promise<{ stored: boolean }> {
    const ok = dto.outcome === 'ok' ? parseOkCheck(dto) : null;
    if (!ok && !dto.error) {
      throw new BadRequestException('A failed check needs its error');
    }
    const checkedAt = new Date(dto.checkedAt);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const known = await tx.outageCheck.findUnique({
          where: { sourceId_checkedAt: { sourceId, checkedAt } },
        });
        if (known) return { stored: false };

        // A check delivered after a newer successful one is only logged.
        const newer = await tx.outageCheck.findFirst({
          where: { sourceId, outcome: 'OK', checkedAt: { gt: checkedAt } },
        });
        await tx.outageCheck.create({
          data: {
            sourceId,
            checkedAt,
            outcome: dto.outcome.toUpperCase() as 'OK',
            usedBrowser: dto.usedBrowser,
            error: dto.error ?? null,
          },
        });
        if (ok && !newer) await this.apply(tx, sourceId, checkedAt, ok);
        return { stored: true };
      });
    } catch (e) {
      // The same check sent twice at once: the other request stored it.
      if ((e as { code?: string }).code === 'P2002') {
        return { stored: false };
      }
      throw e;
    }
  }

  private async apply(
    tx: Tx,
    sourceId: number,
    checkedAt: Date,
    check: OkCheck,
  ) {
    const { house } = check;
    await tx.outageSource.update({
      where: { id: sourceId },
      data: house.found
        ? { houseState: 'FOUND', groups: house.groups }
        : { houseState: 'NOT_FOUND', groups: [] },
    });

    for (const [group, days] of Object.entries(check.weekly)) {
      const ordered = Object.fromEntries(
        Object.entries(days).sort(([a], [b]) => a.localeCompare(b)),
      );
      const hash = createHash('sha256')
        .update(JSON.stringify(ordered))
        .digest('hex');
      const latest = await tx.outageWeeklyPattern.findFirst({
        where: { sourceId, group },
        orderBy: { seenAt: 'desc' },
        select: { hash: true },
      });
      if (latest?.hash !== hash) {
        await tx.outageWeeklyPattern.create({
          data: { sourceId, group, days: ordered, hash, seenAt: checkedAt },
        });
      }
    }

    for (const [dayKey, groups] of Object.entries(check.confirmed.days)) {
      const day = new Date(`${dayKey}T00:00:00Z`);
      for (const [group, slots] of Object.entries(groups)) {
        const where = { sourceId_group_day: { sourceId, group, day } };
        const existing = await tx.outageConfirmedDay.findUnique({ where });
        if (!existing) {
          await tx.outageConfirmedDay.create({
            data: {
              sourceId,
              group,
              day,
              slots,
              siteUpdated: check.confirmed.updated,
              firstSeenAt: checkedAt,
              changedAt: checkedAt,
            },
          });
          continue;
        }
        const changed =
          JSON.stringify(existing.slots) !== JSON.stringify(slots);
        await tx.outageConfirmedDay.update({
          where,
          data: {
            siteUpdated: check.confirmed.updated,
            ...(changed && { slots, changedAt: checkedAt }),
          },
        });
      }
    }
  }
}
