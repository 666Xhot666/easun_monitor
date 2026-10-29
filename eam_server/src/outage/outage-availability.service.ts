import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramAlerts } from '../telegram/telegram-alerts';
import { STALE_AFTER_MS } from './constants';

/** Why the checks fail, by the last check's outcome. */
/** Why the reader failed, by check outcome: keys of outage.reasons in the catalogs. */
const FAILURE: Record<string, string> = {
  CHALLENGE: 'blocked',
  REJECTED: 'blocked',
  SHAPE: 'changed',
  SERVER: 'down',
  NETWORK: 'unreachable',
};

/**
 * "Outage schedule unavailable" once a source has had no successful check
 * for 12 hours, and "back" when one succeeds again. State is in memory:
 * after a restart the first round is a silent baseline.
 */
@Injectable()
export class OutageAvailability {
  private readonly logger = new Logger(OutageAvailability.name);
  /** Sources reported unavailable, with their last good time (ms). */
  private readonly down = new Map<number, number>();
  private started = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: TelegramAlerts,
  ) {}

  @Interval(60_000)
  async check(now = new Date()): Promise<void> {
    const baseline = !this.started;
    this.started = true;
    try {
      const sources = await this.prisma.outageSource.findMany({
        where: { enabled: true },
        select: { id: true, inverterProfileId: true, createdAt: true },
      });
      const enabled = new Set(sources.map((s) => s.id));
      for (const id of this.down.keys()) {
        if (!enabled.has(id)) this.down.delete(id);
      }
      for (const source of sources) {
        await this.checkSource(source, now, baseline);
      }
    } catch (error) {
      this.logger.warn(
        `Outage schedule watch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async checkSource(
    source: { id: number; inverterProfileId: number; createdAt: Date },
    now: Date,
    baseline: boolean,
  ): Promise<void> {
    const [lastOk, last] = await Promise.all([
      this.prisma.outageCheck.findFirst({
        where: { sourceId: source.id, outcome: 'OK' },
        orderBy: { checkedAt: 'desc' },
        select: { checkedAt: true },
      }),
      this.prisma.outageCheck.findFirst({
        where: { sourceId: source.id },
        orderBy: { checkedAt: 'desc' },
        select: { outcome: true },
      }),
    ]);
    // Without any successful check, counted from when the address was set.
    const good = (lastOk?.checkedAt ?? source.createdAt).getTime();
    const reportedSince = this.down.get(source.id);

    if (now.getTime() - good >= STALE_AFTER_MS) {
      if (reportedSince !== undefined) return;
      this.down.set(source.id, good);
      if (baseline) return;
      const reason =
        last && last.outcome !== 'OK' ? FAILURE[last.outcome] : 'silent';
      await this.alerts.toHousehold(source.inverterProfileId, {
        key: 'scheduleUnavailable',
        params: { forMs: now.getTime() - good, reason },
      });
      return;
    }
    if (reportedSince === undefined) return;
    this.down.delete(source.id);
    await this.alerts.toHousehold(source.inverterProfileId, {
      key: 'scheduleBack',
      params: { downMs: good - reportedSince },
    });
  }
}
