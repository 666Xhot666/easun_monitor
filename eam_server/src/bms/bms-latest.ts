import { Global, Injectable, Module } from '@nestjs/common';
import type { BmsReading } from './reading';

export interface LatestBmsReading {
  reading: BmsReading;
  receivedAt: Date;
}

/**
 * The newest reading of each BMS, in memory: every reading that arrives,
 * not only the stored ones. Shared by ingest (writes) and the readers.
 */
@Injectable()
export class BmsLatest {
  private readonly latest = new Map<number, LatestBmsReading>();

  /** Keeps the reading if it is newer than the one held. */
  set(deviceId: number, reading: BmsReading, receivedAt = new Date()): boolean {
    const current = this.latest.get(deviceId);
    if (
      current &&
      Date.parse(current.reading.timestamp) >= Date.parse(reading.timestamp)
    )
      return false;
    this.latest.set(deviceId, { reading, receivedAt });
    return true;
  }

  get(deviceId: number): LatestBmsReading | null {
    return this.latest.get(deviceId) ?? null;
  }
}

@Global()
@Module({ providers: [BmsLatest], exports: [BmsLatest] })
export class BmsLatestModule {}
