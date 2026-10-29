import { Injectable } from '@nestjs/common';
import { HouseholdsService } from '../households/households.service';
import { PrismaService } from '../prisma/prisma.service';
import type { DaySlots } from '../outage-reader/dnem/schedule-page';
import {
  SITE_TIME_ZONE,
  localDateOf,
  nextDay,
  wallToUtc,
  type LocalDate,
} from '../outage-reader/dnem/windows';
import { buildForecast, type OutageForecast } from './forecast';

function dayKey(d: LocalDate): string {
  const y = d.year;
  const m = String(d.month).padStart(2, '0');
  const day = String(d.day).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable()
export class OutageForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
  ) {}

  /**
   * The outage forecast of an inverter over [from, to); for the server's own use (rules, notifications), so no access check.
   */
  async getOutageForecast(
    profileId: number,
    from: Date,
    to: Date,
    now = new Date(),
  ): Promise<OutageForecast> {
    const source = await this.prisma.outageSource.findUnique({
      where: { inverterProfileId: profileId },
      select: { id: true, enabled: true, houseState: true, groups: true },
    });

    if (!source) {
      return buildForecast(
        {
          source: null,
          lastCheck: null,
          lastOkAt: null,
          events: [],
          weekly: {},
          coveredDays: [],
        },
        from,
        to,
        now,
      );
    }

    const sourceId = source.id;

    const [lastCheck, lastOk, events, patterns, confirmed] = await Promise.all([
      this.prisma.outageCheck.findFirst({
        where: { sourceId },
        orderBy: { checkedAt: 'desc' },
        select: { checkedAt: true, outcome: true, error: true },
      }),
      this.prisma.outageCheck.findFirst({
        where: { sourceId, outcome: 'OK' },
        orderBy: { checkedAt: 'desc' },
        select: { checkedAt: true },
      }),
      this.prisma.outageEvent.findMany({
        where: {
          sourceId,
          withdrawnAt: null,
          start: { lt: to },
          end: { gt: from },
        },
        orderBy: { start: 'asc' },
        select: {
          kind: true,
          status: true,
          description: true,
          start: true,
          end: true,
        },
      }),
      Promise.all(
        source.groups.map((group) =>
          this.prisma.outageWeeklyPattern.findFirst({
            where: { sourceId, group },
            orderBy: { seenAt: 'desc' },
            select: { group: true, days: true },
          }),
        ),
      ),
      this.prisma.outageConfirmedDay.findMany({
        where: {
          sourceId,
          group: { in: source.groups },
          day: {
            gte: new Date(`${dayKey(localDateOf(from))}T00:00:00Z`),
            lte: new Date(`${dayKey(localDateOf(to))}T00:00:00Z`),
          },
        },
        select: { day: true },
      }),
    ]);

    const weekly: Record<string, Record<number, DaySlots>> = {};
    for (const p of patterns) {
      if (p) {
        weekly[p.group] = p.days as unknown as Record<number, DaySlots>;
      }
    }

    const coveredDays = [
      ...new Set(confirmed.map((c) => c.day.toISOString().slice(0, 10))),
    ];

    return buildForecast(
      {
        source: {
          enabled: source.enabled,
          houseState: source.houseState,
          groups: source.groups,
        },
        lastCheck,
        lastOkAt: lastOk?.checkedAt ?? null,
        events,
        weekly,
        coveredDays,
      },
      from,
      to,
      now,
    );
  }

  /**
   * Today and tomorrow (site time), the days the site publishes, for a member of the inverter's household.
   */
  async forecastFor(
    profileId: number,
    userId: number,
    now = new Date(),
  ): Promise<OutageForecast> {
    await this.households.requireProfile(profileId, userId, 'read');
    const today = localDateOf(now, SITE_TIME_ZONE);
    const from = new Date(wallToUtc(today, 0));
    const to = new Date(wallToUtc(nextDay(nextDay(today)), 0));
    return this.getOutageForecast(profileId, from, to, now);
  }
}
