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
import { PAIR_MAX_GAP_MS, ROLLUP_INTERVAL_MS } from './constants';
import type { VoltagePair } from './wiring-drop';

export const BMS_SERIES: SeriesTables = {
  raw: 'bms_logs',
  hourly: 'bms_log_hourly',
  key: '"bmsDeviceId"',
};

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
   * Stored BMS readings of [from, to) paired with the inverter reading
   * nearest in time (within PAIR_MAX_GAP_MS), for comparing the two
   * voltages. The inverter's values come from its registers of the given
   * names. Oldest first.
   */
  async voltagePairs(
    bmsDeviceId: number,
    inverterProfileId: number,
    registers: { voltage: string; current: string },
    from: Date,
    to: Date,
  ): Promise<(VoltagePair & { at: Date })[]> {
    const gap = `${PAIR_MAX_GAP_MS} milliseconds`;
    const rows = await this.prisma.$queryRaw<
      { at: Date; bv: number; ba: number; iv: number; ia: number }[]
    >`
      SELECT b.timestamp AS at,
        (b.payload->>'packVoltageV')::float AS bv,
        (b.payload->>'currentA')::float AS ba,
        (i.payload->>${registers.voltage})::float AS iv,
        (i.payload->>${registers.current})::float AS ia
      FROM bms_logs b
      CROSS JOIN LATERAL (
        SELECT payload FROM inverter_logs
        WHERE "inverterProfileId" = ${inverterProfileId}
          AND timestamp BETWEEN b.timestamp - ${gap}::interval AND b.timestamp + ${gap}::interval
        ORDER BY abs(extract(epoch FROM timestamp - b.timestamp))
        LIMIT 1
      ) i
      WHERE b."bmsDeviceId" = ${bmsDeviceId}
        AND b.timestamp >= ${from} AND b.timestamp < ${to}
        AND b.payload ? 'packVoltageV' AND b.payload ? 'currentA'
        AND i.payload ? ${registers.voltage} AND i.payload ? ${registers.current}
      ORDER BY b.timestamp`;
    return rows.map((r) => ({
      at: r.at,
      bmsVoltageV: r.bv,
      bmsCurrentA: r.ba,
      inverterVoltageV: r.iv,
      inverterCurrentA: r.ia,
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
