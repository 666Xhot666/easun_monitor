import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  rollUpSeries,
  seriesHistory,
  type History,
  type HistoryQuery,
  type SeriesTables,
} from '../telemetry/time-series';
import type { BmsReading } from './reading';

export const BMS_SERIES: SeriesTables = {
  raw: 'bms_logs',
  hourly: 'bms_log_hourly',
  key: '"bmsDeviceId"',
};

/** How often the hourly averages catch up with new readings. */
const ROLLUP_INTERVAL_MS = 10 * 60_000;

/** Stored BMS readings: history and hourly averages, like the Telemetry store. */
@Injectable()
export class BmsStore {
  private readonly logger = new Logger(BmsStore.name);
  private rollingUp = false;

  constructor(private readonly prisma: PrismaService) {}

  history(bmsDeviceId: number, query: HistoryQuery): Promise<History> {
    return seriesHistory(this.prisma, BMS_SERIES, bmsDeviceId, query);
  }

  /** The newest stored reading, for when none has arrived since start-up. */
  async newest(bmsDeviceId: number): Promise<BmsReading | null> {
    const row = await this.prisma.bmsLog.findFirst({
      where: { bmsDeviceId },
      orderBy: { timestamp: 'desc' },
      select: { payload: true },
    });
    return row ? (row.payload as unknown as BmsReading) : null;
  }

  /** Stored readings of a device in [from, to), newest first, a page at a time. */
  async readings(
    bmsDeviceId: number,
    query: { from: Date; to: Date; limit: number; before?: Date },
  ): Promise<{ id: number; timestamp: Date; reading: BmsReading }[]> {
    const rows = await this.prisma.bmsLog.findMany({
      where: {
        bmsDeviceId,
        timestamp: {
          gte: query.from,
          lt: query.before && query.before < query.to ? query.before : query.to,
        },
      },
      orderBy: { timestamp: 'desc' },
      take: query.limit,
      select: { id: true, timestamp: true, payload: true },
    });

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      reading: row.payload as unknown as BmsReading,
    }));
  }

  /**
   * Every stored reading in [from, to), oldest first, `batchSize` at a time
   * so a long export never holds the whole range in memory.
   */
  async *readingBatches(
    bmsDeviceId: number,
    from: Date,
    to: Date,
    batchSize = 1000,
  ): AsyncGenerator<BmsReading[]> {
    let after: Date | null = null;
    for (;;) {
      const rows: { timestamp: Date; payload: unknown }[] =
        await this.prisma.bmsLog.findMany({
          where: {
            bmsDeviceId,
            // Timestamps are unique per device, so the last one is the cursor.
            timestamp: after ? { gt: after, lt: to } : { gte: from, lt: to },
          },
          orderBy: { timestamp: 'asc' },
          take: batchSize,
          select: { timestamp: true, payload: true },
        });
      if (rows.length === 0) return;
      yield rows.map((row) => row.payload as BmsReading);
      if (rows.length < batchSize) return;
      after = rows[rows.length - 1].timestamp;
    }
  }

  async rollUp(): Promise<void> {
    const updated = await rollUpSeries(this.prisma, BMS_SERIES);
    this.logger.debug(`BMS hourly rollups refreshed (${updated} hour(s))`);
  }

  @Interval('bms-rollup', ROLLUP_INTERVAL_MS)
  async scheduledRollUp(): Promise<void> {
    if (this.rollingUp) return;
    this.rollingUp = true;
    try {
      await this.rollUp();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`BMS hourly rollup failed: ${message}`);
    } finally {
      this.rollingUp = false;
    }
  }
}
