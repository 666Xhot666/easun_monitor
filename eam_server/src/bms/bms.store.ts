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
