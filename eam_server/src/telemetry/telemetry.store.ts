import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  INVERTER_SERIES,
  rollUpSeries,
  seriesHistory,
  type History,
  type HistoryQuery,
} from './time-series';

/** A reading as stored: register name -> value. */
export type ReadingPayload = Record<string, number>;

export type { History, HistoryPoint, HistoryQuery } from './time-series';

export interface ReadingsQuery {
  from: Date;
  to: Date;
  limit: number;
  /** Only readings older than this (the last one of the previous page). */
  before?: Date;
}

/** Energy over a range, from integrating the readings' power. */
export interface EnergyTotals {
  pvKWh: number;
  /** Energy imported from the grid. */
  gridKWh: number;
  /** Energy delivered to the loads. */
  outputKWh: number;
  /** Energy into and out of the battery, at its terminals. */
  batteryChargeKWh: number;
  batteryDischargeKWh: number;
  /** Time between readings that was integrated (gaps left out). */
  coveredSeconds: number;
}

type EnergyRow = Record<keyof EnergyTotals, number | string>;

/** A reading row before its payload is narrowed. */
type StoredRow = Omit<StoredReading, 'payload'> & { payload: Prisma.JsonValue };

/** One poll cycle's reading, as stored. */
export interface StoredReading {
  id: number;
  timestamp: Date;
  payload: ReadingPayload;
}

/** Readings further apart than this are not integrated across. */
const MAX_ENERGY_GAP_SECONDS = 600;
/** How often the hourly rollups catch up with new readings. */
const ROLLUP_INTERVAL_MS = 10 * 60_000;

/**
 * The Telemetry store: records polled readings and answers "latest" and
 * time-range history for charts.
 *
 * Raw readings are kept forever (they are the dataset for long-range
 * analysis). Ranges with buckets of an hour or more are answered from
 * InverterLogHourly, a derived table kept current by `rollUp`, so a
 * one- or two-year chart reads ~17k hourly rows instead of millions.
 */
@Injectable()
export class TelemetryStore {
  private readonly logger = new Logger(TelemetryStore.name);
  private rollingUp = false;

  constructor(private readonly prisma: PrismaService) {}

  async record(
    profileId: number,
    payload: ReadingPayload,
    at: Date = new Date(),
  ): Promise<void> {
    await this.prisma.inverterLog.create({
      data: { inverterProfileId: profileId, payload, timestamp: at },
    });
  }

  latest(profileId: number) {
    return this.prisma.inverterLog.findFirst({
      where: { inverterProfileId: profileId },
      orderBy: { timestamp: 'desc' },
    });
  }

  /**
   * Raw readings in [from, to), newest first, at most `limit`. Pass the
   * oldest timestamp already shown as `before` to get the next page.
   */
  async readings(
    profileId: number,
    query: ReadingsQuery,
  ): Promise<StoredReading[]> {
    const rows = await this.prisma.inverterLog.findMany({
      where: {
        inverterProfileId: profileId,
        timestamp: {
          gte: query.from,
          lt: query.before && query.before < query.to ? query.before : query.to,
        },
      },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: query.limit,
      select: { id: true, timestamp: true, payload: true },
    });
    return rows.map((row) => ({
      ...row,
      payload: row.payload as ReadingPayload,
    }));
  }

  /**
   * Every reading in [from, to), oldest first, fetched `batchSize` at a
   * time so a long export never holds the whole range in memory.
   */
  async *readingBatches(
    profileId: number,
    from: Date,
    to: Date,
    batchSize = 1000,
  ): AsyncGenerator<StoredReading[]> {
    let after: { timestamp: Date; id: number } | null = null;
    for (;;) {
      const rows: StoredRow[] = await this.prisma.inverterLog.findMany({
        where: {
          inverterProfileId: profileId,
          timestamp: { gte: from, lt: to },
          ...(after && {
            OR: [
              { timestamp: { gt: after.timestamp } },
              { timestamp: after.timestamp, id: { gt: after.id } },
            ],
          }),
        },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: { id: true, timestamp: true, payload: true },
      });
      if (rows.length === 0) return;
      yield rows.map((row) => ({
        ...row,
        payload: row.payload as ReadingPayload,
      }));
      if (rows.length < batchSize) return;
      after = rows[rows.length - 1];
    }
  }

  /**
   * Energy over [from, to), integrated from consecutive raw readings with
   * the trapezoid rule: each pair adds the average of its two powers times
   * the time between them. Pairs more than 10 minutes apart are left out
   * (`coveredSeconds` says how much was integrated), negative PV and load
   * count as zero, and only grid import counts.
   */
  async energy(
    profileId: number,
    range: { from: Date; to: Date },
  ): Promise<EnergyTotals> {
    const [row] = await this.prisma.$queryRaw<EnergyRow[]>`
      WITH r AS (
        -- Negative PV or load is sensor noise; negative grid power would be
        -- export, which is not import. CASE, not GREATEST: GREATEST(NULL, 0)
        -- is 0, and a missing value must stay missing. Battery power is
        -- voltage times the signed current (+ charging, - discharging),
        -- split into its charging and discharging parts.
        SELECT extract(epoch FROM l."timestamp") AS t,
               CASE WHEN p.pv < 0 THEN 0 ELSE p.pv END AS pv,
               CASE WHEN p.grid < 0 THEN 0 ELSE p.grid END AS grid,
               CASE WHEN p.output < 0 THEN 0 ELSE p.output END AS output,
               CASE WHEN p.battery < 0 THEN 0 ELSE p.battery END AS charge,
               CASE WHEN p.battery > 0 THEN 0 ELSE -p.battery END AS discharge
        FROM inverter_logs l
        CROSS JOIN LATERAL (
          SELECT (l.payload ->> 'PVPower')::float8 AS pv,
                 (l.payload ->> 'AverageMainsPower')::float8 AS grid,
                 (l.payload ->> 'OutputActivePower')::float8 AS output,
                 (l.payload ->> 'BatteryVoltage')::float8
                   * (l.payload ->> 'BatteryCurrentSigned')::float8 AS battery
        ) p
        WHERE l."inverterProfileId" = ${profileId}
          AND l."timestamp" >= ${range.from.toISOString()}::timestamp
          AND l."timestamp" < ${range.to.toISOString()}::timestamp
      ),
      pairs AS (
        SELECT t - lag(t) OVER w AS dt,
               (pv + lag(pv) OVER w) / 2 AS pv,
               (grid + lag(grid) OVER w) / 2 AS grid,
               (output + lag(output) OVER w) / 2 AS output,
               (charge + lag(charge) OVER w) / 2 AS charge,
               (discharge + lag(discharge) OVER w) / 2 AS discharge
        FROM r
        WINDOW w AS (ORDER BY t)
      ),
      -- Longer silences (logger offline, server down) are left out, not guessed.
      covered AS (
        SELECT * FROM pairs WHERE dt <= ${MAX_ENERGY_GAP_SECONDS}
      )
      SELECT coalesce(sum(pv * dt), 0) / 3.6e6 AS "pvKWh",
             coalesce(sum(grid * dt), 0) / 3.6e6 AS "gridKWh",
             coalesce(sum(output * dt), 0) / 3.6e6 AS "outputKWh",
             coalesce(sum(charge * dt), 0) / 3.6e6 AS "batteryChargeKWh",
             coalesce(sum(discharge * dt), 0) / 3.6e6 AS "batteryDischargeKWh",
             coalesce(sum(dt), 0) AS "coveredSeconds"
      FROM covered`;
    return {
      pvKWh: Number(row.pvKWh),
      gridKWh: Number(row.gridKWh),
      outputKWh: Number(row.outputKWh),
      batteryChargeKWh: Number(row.batteryChargeKWh),
      batteryDischargeKWh: Number(row.batteryDischargeKWh),
      coveredSeconds: Number(row.coveredSeconds),
    };
  }

  history(profileId: number, query: HistoryQuery): Promise<History> {
    return seriesHistory(this.prisma, INVERTER_SERIES, profileId, query);
  }

  /**
   * Brings InverterLogHourly up to date: recomputes every hour from one
   * hour before the newest rollup onwards (so the current, still-filling
   * hour is refreshed), or everything on the first run. Idempotent, and
   * never touches raw readings.
   */
  async rollUp(): Promise<void> {
    const updated = await rollUpSeries(this.prisma, INVERTER_SERIES);
    this.logger.debug(`Hourly rollups refreshed (${updated} hour(s))`);
  }

  @Interval('telemetry-rollup', ROLLUP_INTERVAL_MS)
  async scheduledRollUp(): Promise<void> {
    if (this.rollingUp) return;
    this.rollingUp = true;
    try {
      await this.rollUp();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Hourly rollup failed: ${message}`);
    } finally {
      this.rollingUp = false;
    }
  }
}
