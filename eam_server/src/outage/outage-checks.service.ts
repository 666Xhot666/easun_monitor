import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { hashIngestToken } from '../bms/ingest-token';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  dayWindows,
  mergeWindows,
  wallToUtc,
  type LocalDate,
} from '../outage-reader/dnem/windows';
import { parseOkCheck, type OkCheck } from './check-payload';
import {
  planEvents,
  type EventStatus,
  type IncomingEvent,
} from './event-matching';
import type { PostOutageCheckDto } from './dto/post-outage-check.dto';
import { scheduleUpdateMessage, type ScheduleChange } from './notices';
import { TelegramAlerts } from '../telegram/telegram-alerts';

type Tx = Prisma.TransactionClient;

/**
 * Stores the reader's checks: every check in the log, and from a successful
 * one the house's groups, its weekly pattern (a new version only when it
 * changes) and its confirmed days (the latest version of each).
 */
@Injectable()
export class OutageChecksService {
  private readonly logger = new Logger(OutageChecksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: TelegramAlerts,
  ) {}

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

    let changes: ScheduleChange[] = [];
    let stored: { stored: boolean };
    try {
      stored = await this.prisma.$transaction(async (tx) => {
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
        if (ok && !newer) {
          changes = await this.apply(tx, sourceId, checkedAt, ok);
        }
        return { stored: true };
      });
    } catch (e) {
      // The same check sent twice at once: the other request stored it.
      if ((e as { code?: string }).code === 'P2002') {
        return { stored: false };
      }
      throw e;
    }
    await this.tell(sourceId, changes);
    return stored;
  }

  /** "Outage schedule updated" to the household, once the check is stored. */
  private async tell(sourceId: number, changes: ScheduleChange[]) {
    const message = scheduleUpdateMessage(changes, new Date());
    if (!message) return;
    try {
      const source = await this.prisma.outageSource.findUnique({
        where: { id: sourceId },
        select: { inverterProfileId: true },
      });
      if (source)
        await this.alerts.toHousehold(source.inverterProfileId, message);
    } catch (e) {
      this.logger.warn(
        `Schedule update not sent: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Stores a successful check, returning what it changed for the house; the
   * first check of an address is the baseline and reports nothing.
   */
  private async apply(
    tx: Tx,
    sourceId: number,
    checkedAt: Date,
    check: OkCheck,
  ): Promise<ScheduleChange[]> {
    const { house } = check;
    const before = await tx.outageSource.findUniqueOrThrow({
      where: { id: sourceId },
      select: { houseState: true },
    });
    const changes: ScheduleChange[] = [];
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
          const published = house.found && house.groups.includes(group);
          if (
            published &&
            !changes.some((c) => c.type === 'published' && c.day === dayKey)
          ) {
            changes.push({ type: 'published', day: dayKey });
          }
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

    if (house.found) {
      changes.push(
        ...(await this.updateRepairs(tx, sourceId, checkedAt, house.outage)),
        ...(await this.updateSchedule(
          tx,
          sourceId,
          checkedAt,
          check,
          house.groups,
        )),
      );
    }
    return before.houseState === 'FOUND' ? changes : [];
  }

  /** The repair the site lists for the house, if any, as an event. */
  private async updateRepairs(
    tx: Tx,
    sourceId: number,
    checkedAt: Date,
    outage: Extract<OkCheck['house'], { found: true }>['outage'],
  ) {
    const shown: IncomingEvent[] = outage
      ? [
          {
            start: outage.start,
            end: outage.end,
            status: 'OFF',
            description: outage.description,
          },
        ]
      : [];
    return this.updateEvents(
      tx,
      sourceId,
      checkedAt,
      'REPAIR',
      shown,
      () => true,
    );
  }

  /**
   * The confirmed schedule of the house's groups as events. The check speaks
   * only for the days it shows: events on other days stay as they were.
   */
  private async updateSchedule(
    tx: Tx,
    sourceId: number,
    checkedAt: Date,
    check: OkCheck,
    groups: string[],
  ) {
    const covered: Array<{ start: number; end: number }> = [];
    const windows = [];
    for (const [dayKey, byGroup] of Object.entries(check.confirmed.days)) {
      const published = groups.filter((g) => byGroup[g]);
      if (published.length === 0) continue;
      const [year, month, day] = dayKey.split('-').map(Number);
      const date: LocalDate = { year, month, day };
      covered.push({
        start: wallToUtc(date, 0),
        end: wallToUtc(date, 24 * 60),
      });
      for (const group of published) {
        windows.push(...dayWindows(date, byGroup[group], 'confirmed'));
      }
    }
    const shown: IncomingEvent[] = mergeWindows(windows).map((w) => ({
      start: w.start,
      end: w.end,
      status: w.status.toUpperCase() as EventStatus,
      description: null,
    }));
    const onCoveredDay = (e: { start: Date; end: Date }) =>
      covered.some(
        (d) => e.start.getTime() < d.end && d.start < e.end.getTime(),
      );
    return this.updateEvents(
      tx,
      sourceId,
      checkedAt,
      'SCHEDULE',
      shown,
      onCoveredDay,
    );
  }

  /**
   * Matches what the check shows with the known events of one kind (see
   * event-matching.ts). Only outages not over yet take part: what has ended
   * stays as last seen.
   */
  private async updateEvents(
    tx: Tx,
    sourceId: number,
    checkedAt: Date,
    kind: 'REPAIR' | 'SCHEDULE',
    shown: IncomingEvent[],
    inScope: (e: { start: Date; end: Date }) => boolean,
  ): Promise<ScheduleChange[]> {
    const known = (
      await tx.outageEvent.findMany({
        where: { sourceId, kind, withdrawnAt: null, end: { gt: checkedAt } },
      })
    ).filter(inScope);
    const plan = planEvents(
      known,
      shown.filter((e) => e.end > checkedAt),
    );

    for (const e of plan.create) {
      await tx.outageEvent.create({
        data: {
          sourceId,
          kind,
          ...e,
          announcedStart: e.start,
          announcedEnd: e.end,
          firstSeenAt: checkedAt,
          lastSeenAt: checkedAt,
        },
      });
    }
    for (const { id, ...e } of plan.revise) {
      await tx.outageEvent.update({
        where: { id },
        data: { ...e, lastSeenAt: checkedAt, revisedAt: checkedAt },
      });
    }
    await tx.outageEvent.updateMany({
      where: { id: { in: plan.unchanged } },
      data: { lastSeenAt: checkedAt },
    });
    await tx.outageEvent.updateMany({
      where: { id: { in: plan.withdraw } },
      data: { withdrawnAt: checkedAt },
    });

    const byId = new Map(known.map((e) => [e.id, e]));
    return [
      ...plan.create.map((e) => ({ type: 'new' as const, kind, ...e })),
      ...plan.revise.map(({ id, ...e }) => {
        const was = byId.get(id)!;
        return {
          type: 'revised' as const,
          kind,
          ...e,
          before: { start: was.start, end: was.end },
        };
      }),
      ...plan.withdraw.map((id) => {
        const { start, end, status, description } = byId.get(id)!;
        return {
          type: 'withdrawn' as const,
          kind,
          start,
          end,
          status,
          description,
        };
      }),
    ];
  }
}
