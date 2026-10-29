import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { hashIngestToken, newIngestToken } from '../bms/ingest-token';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { HostSample } from '../server-agent/sample';
import { ServerAccessService } from './server-access.service';
import { AGENT_STALE_MS, HISTORY_RANGES, KEEP_SAMPLES_MS } from './constants';

export type HistoryRange = keyof typeof HISTORY_RANGES;

/** One bucket of the history: averages, and the hottest temperature. */
export interface HistoryPoint {
  at: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  /** The hottest sensor in the bucket. */
  temperatureMax: number | null;
  /** The first fan. */
  fanRpm: number | null;
  /** All interfaces together. */
  rxBytesPerSecond: number | null;
  txBytesPerSecond: number | null;
}

const round = (v: number | null, decimals: number) =>
  v === null ? null : Math.round(v * 10 ** decimals) / 10 ** decimals;

/** The server agent's token, its samples, and the latest one for the server page. */
@Injectable()
export class ServerAgentService {
  private readonly logger = new Logger(ServerAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ServerAccessService,
  ) {}

  /** A new agent token, shown once; the old one stops working. */
  async newToken(ownerId: number): Promise<{ token: string }> {
    await this.access.requireOwner(ownerId);
    const { token, hash } = newIngestToken();
    await this.prisma.serverAgent.upsert({
      where: { id: 1 },
      create: { id: 1, tokenHash: hash },
      update: { tokenHash: hash, lastSeenAt: null },
    });
    return { token };
  }

  /** Whether `token` is the agent's, noting that it was seen. */
  async isAgent(token: string): Promise<boolean> {
    const { count } = await this.prisma.serverAgent.updateMany({
      where: { tokenHash: hashIngestToken(token) },
      data: { lastSeenAt: new Date() },
    });
    return count > 0;
  }

  /** Stores a sample; one re-sent (same time) is stored once. */
  async ingest(sample: HostSample): Promise<{ stored: boolean }> {
    try {
      await this.prisma.serverSample.create({
        data: {
          at: new Date(sample.at),
          data: sample as unknown as Prisma.InputJsonValue,
        },
      });
      return { stored: true };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { stored: false };
      throw e;
    }
  }

  /** The latest sample, for the owner and viewers. */
  async status(userId: number, now = new Date()) {
    await this.access.requireViewer(userId);
    const [agent, latest] = await Promise.all([
      this.prisma.serverAgent.findUnique({ where: { id: 1 } }),
      this.prisma.serverSample.findFirst({ orderBy: { at: 'desc' } }),
    ]);
    return {
      agent: {
        configured: agent !== null,
        lastSeenAt: agent?.lastSeenAt ?? null,
      },
      sample: (latest?.data as unknown as HostSample) ?? null,
      stale: !latest || now.getTime() - latest.at.getTime() > AGENT_STALE_MS,
    };
  }

  /** CPU, memory, temperature, fan and network over the last day or week, in buckets. */
  async history(
    userId: number,
    range: string = '24h',
    to = new Date(),
  ): Promise<{ bucketSeconds: number; points: HistoryPoint[] }> {
    await this.access.requireViewer(userId);
    if (!(range in HISTORY_RANGES)) {
      throw new BadRequestException('range must be 24h or 7d');
    }
    if (Number.isNaN(to.getTime())) {
      throw new BadRequestException('to must be a time');
    }
    const { spanMs, bucketSeconds } = HISTORY_RANGES[range as HistoryRange];
    const from = new Date(to.getTime() - spanMs);
    const bucket = `${bucketSeconds} seconds`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        bucket: Date;
        cpu: number | null;
        mem: number | null;
        temp: number | null;
        fan: number | null;
        rx: number | null;
        tx: number | null;
      }>
    >`
      WITH s AS (
        SELECT
          date_bin(${bucket}::interval, at, TIMESTAMP '2000-01-01') AS bucket,
          (data->'cpu'->>'usagePercent')::float8 AS cpu,
          CASE WHEN (data->'memory'->>'totalBytes')::float8 > 0
            THEN 100 * (1 - (data->'memory'->>'availableBytes')::float8
                          / (data->'memory'->>'totalBytes')::float8)
          END AS mem,
          (SELECT max((t->>'celsius')::float8)
             FROM jsonb_array_elements(data->'temperatures') t) AS temp,
          (data->'fans'->0->>'rpm')::float8 AS fan,
          (SELECT sum((n->>'rxBytesPerSecond')::float8)
             FROM jsonb_array_elements(data->'network') n) AS rx,
          (SELECT sum((n->>'txBytesPerSecond')::float8)
             FROM jsonb_array_elements(data->'network') n) AS tx
        FROM server_samples
        WHERE at >= ${from} AND at < ${to}
      )
      SELECT bucket, avg(cpu) AS cpu, avg(mem) AS mem, max(temp) AS temp,
             avg(fan) AS fan, avg(rx) AS rx, avg(tx) AS tx
      FROM s GROUP BY bucket ORDER BY bucket`;
    return {
      bucketSeconds,
      points: rows.map((r) => ({
        at: r.bucket.toISOString(),
        cpuPercent: round(r.cpu, 1),
        memoryPercent: round(r.mem, 1),
        temperatureMax: round(r.temp, 1),
        fanRpm: round(r.fan, 0),
        rxBytesPerSecond: round(r.rx, 0),
        txBytesPerSecond: round(r.tx, 0),
      })),
    };
  }

  /** Forgets samples older than 30 days. */
  @Interval(60 * 60_000)
  async prune(now = new Date()): Promise<void> {
    try {
      await this.prisma.serverSample.deleteMany({
        where: { at: { lt: new Date(now.getTime() - KEEP_SAMPLES_MS) } },
      });
    } catch (e) {
      this.logger.warn(
        `Pruning server samples failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
