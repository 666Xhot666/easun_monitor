import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashIngestToken } from './ingest-token';
import type { BmsReading } from './reading';
import { TelegramAlerts } from '../telegram/telegram-alerts';
import { BmsLatest, type LatestBmsReading } from './bms-latest';

const DEFAULT_STORE_INTERVAL_MS = 30_000;
/** Clock skew allowed for a producer's timestamp. */
const MAX_FUTURE_MS = 60_000;
/** Oldest reading accepted: the reader queues a few minutes while the server is down. */
const MAX_AGE_MS = 3_600_000;
/** Per device: twice what a producer posting every second would send. */
const RATE_LIMIT = { requests: 120, windowMs: 60_000 };

/**
 * Takes readings from BMS producers. The BMS streams about one frame a
 * second; storing all of them would be noise, so at most one reading per
 * BMS_STORE_INTERVAL_MS (default 30 s, the inverter's cadence) is stored per
 * device, while the newest is always kept in memory for the live view.
 */
@Injectable()
export class BmsIngestService {
  private readonly lastStoredAt = new Map<number, number>();
  private readonly recentPosts = new Map<number, number[]>();
  private readonly storeIntervalMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly alerts: TelegramAlerts,
    private readonly latest: BmsLatest,
  ) {
    const configured = Number(config.get<string>('BMS_STORE_INTERVAL_MS'));
    this.storeIntervalMs =
      configured > 0 ? configured : DEFAULT_STORE_INTERVAL_MS;
  }

  /** The device a bearer token belongs to, or null. */
  async deviceForToken(token: string): Promise<{ id: number } | null> {
    return this.prisma.bmsDevice.findUnique({
      where: { tokenHash: hashIngestToken(token) },
      select: { id: true },
    });
  }

  async ingest(
    deviceId: number,
    reading: BmsReading,
    now = new Date(),
  ): Promise<{ stored: boolean }> {
    this.limitRate(deviceId, now.getTime());
    const at = Date.parse(reading.timestamp);
    if (at > now.getTime() + MAX_FUTURE_MS) {
      throw new BadRequestException(
        'The reading is timestamped in the future: check the producer clock',
      );
    }
    if (at < now.getTime() - MAX_AGE_MS) {
      throw new BadRequestException('The reading is more than an hour old');
    }
    if (this.latest.set(deviceId, reading, now)) {
      void this.alerts
        .onBmsReading(deviceId, reading.alarms ?? [])
        .catch(() => undefined);
    }
    await this.prisma.bmsDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: now },
    });

    const last =
      this.lastStoredAt.get(deviceId) ?? (await this.newestStoredAt(deviceId));
    if (last !== null && at - last < this.storeIntervalMs)
      return { stored: false };
    try {
      await this.prisma.bmsLog.create({
        data: {
          bmsDeviceId: deviceId,
          timestamp: new Date(at),
          payload: reading as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        return { stored: false }; // already stored
      throw error;
    }
    this.lastStoredAt.set(deviceId, Math.max(at, last ?? at));
    return { stored: true };
  }

  private limitRate(deviceId: number, nowMs: number): void {
    const recent = (this.recentPosts.get(deviceId) ?? []).filter(
      (t) => nowMs - t < RATE_LIMIT.windowMs,
    );
    if (recent.length >= RATE_LIMIT.requests) {
      this.recentPosts.set(deviceId, recent);
      throw new HttpException(
        'Too many readings from this device',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(nowMs);
    this.recentPosts.set(deviceId, recent);
  }

  latestFor(deviceId: number): LatestBmsReading | null {
    return this.latest.get(deviceId);
  }

  private async newestStoredAt(deviceId: number): Promise<number | null> {
    const row = await this.prisma.bmsLog.findFirst({
      where: { bmsDeviceId: deviceId },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });
    return row ? row.timestamp.getTime() : null;
  }
}
