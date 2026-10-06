import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import type { Response } from 'express';
import { HistoryQueryDto } from '../inverter/dto/history-query.dto';
import { ReadingsExportQueryDto } from '../inverter/dto/readings-export-query.dto';
import { BmsCsv } from './bms-csv';
import { BmsIngestService } from './bms-ingest.service';
import { BmsStore } from './bms.store';
import { CreateBmsDeviceDto } from './dto/create-bms-device.dto';
import { UpdateBmsDeviceDto } from './dto/update-bms-device.dto';
import { newIngestToken } from './ingest-token';

/** A reading older than this is stale, never shown as current. */
const STALE_AFTER_MS = 30_000;
const DEFAULT_HISTORY_POINTS = 300;
const DEFAULT_HISTORY_SPAN_MS = 60 * 60 * 1000;
const MAX_HISTORY_SPAN_MS = 5 * 366 * 24 * 60 * 60 * 1000;
/** The longest range one export may cover. */
const MAX_EXPORT_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

/** Everything about a device but its token hash. */
export const BMS_DEVICE_FIELDS = {
  id: true,
  name: true,
  sourceType: true,
  bluetoothId: true,
  lastSeenAt: true,
  useForEnergyFlow: true,
  createdAt: true,
  inverterProfileId: true,
} as const;

/** The BMS devices of one of the user's inverters. */
@Controller('api/inverter/profiles/:profileId/bms')
@UseGuards(AuthGuard('jwt'))
export class BmsDevicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: BmsIngestService,
    private readonly store: BmsStore,
  ) {}

  @Get()
  async list(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedProfile(profileId, user.userId);
    return this.prisma.bmsDevice.findMany({
      where: { inverterProfileId: profileId },
      orderBy: { createdAt: 'asc' },
      select: BMS_DEVICE_FIELDS,
    });
  }

  /** Creates the device and returns its ingest token: the only time it is shown. */
  @Post()
  async create(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Body() dto: CreateBmsDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedProfile(profileId, user.userId);
    const { token, hash } = newIngestToken();
    const device = await this.prisma.bmsDevice.create({
      data: {
        inverterProfileId: profileId,
        name: dto.name,
        sourceType: dto.sourceType,
        bluetoothId: dto.bluetoothId ?? null,
        tokenHash: hash,
      },
      select: BMS_DEVICE_FIELDS,
    });
    return { device, token };
  }

  /** Renames the device or switches its use in the energy flow. */
  @Patch(':bmsId')
  async update(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Param('bmsId', ParseIntPipe) bmsId: number,
    @Body() dto: UpdateBmsDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedDevice(profileId, bmsId, user.userId);
    return this.prisma.bmsDevice.update({
      where: { id: bmsId },
      data: dto,
      select: BMS_DEVICE_FIELDS,
    });
  }

  /** Replaces the device's ingest token (shown once); the old one stops working. */
  @Post(':bmsId/token')
  async replaceToken(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Param('bmsId', ParseIntPipe) bmsId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedDevice(profileId, bmsId, user.userId);
    const { token, hash } = newIngestToken();
    await this.prisma.bmsDevice.update({
      where: { id: bmsId },
      data: { tokenHash: hash },
    });
    return { token };
  }

  /** Removes the device and its stored readings. */
  @Delete(':bmsId')
  async remove(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Param('bmsId', ParseIntPipe) bmsId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedDevice(profileId, bmsId, user.userId);
    await this.prisma.bmsDevice.delete({ where: { id: bmsId } });
    return { success: true as const };
  }

  /**
   * The newest reading with its age. "stale" once it is older than 30 s:
   * a stale reading is never to be shown as current.
   */
  @Get(':bmsId/latest')
  async latest(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Param('bmsId', ParseIntPipe) bmsId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedDevice(profileId, bmsId, user.userId);
    const reading =
      this.ingest.latestFor(bmsId)?.reading ?? (await this.store.newest(bmsId));
    if (!reading) throw new NotFoundException('No BMS reading yet');
    const ageSeconds = Math.max(
      0,
      Math.round((Date.now() - Date.parse(reading.timestamp)) / 1000),
    );
    return {
      reading,
      ageSeconds,
      status: ageSeconds * 1000 <= STALE_AFTER_MS ? 'live' : 'stale',
    };
  }

  /** Averaged history over a range, like the inverter's history. */
  @Get(':bmsId/history')
  async history(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Param('bmsId', ParseIntPipe) bmsId: number,
    @Query() query: HistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedDevice(profileId, bmsId, user.userId);
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_HISTORY_SPAN_MS);
    const span = to.getTime() - from.getTime();
    if (span <= 0) throw new BadRequestException('`from` must be before `to`');
    if (span > MAX_HISTORY_SPAN_MS) {
      throw new BadRequestException(
        'A history range can cover at most 5 years',
      );
    }
    return this.store.history(bmsId, {
      from,
      to,
      maxPoints: query.points ?? DEFAULT_HISTORY_POINTS,
      fields: query.fields,
    });
  }

  /**
   * Stored readings of a range as a CSV download, oldest first, streamed in
   * batches. Times are wall-clock time in `tz` (default UTC).
   */
  @Get(':bmsId/export')
  async export(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Param('bmsId', ParseIntPipe) bmsId: number,
    @Query() query: ReadingsExportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    await this.requireOwnedDevice(profileId, bmsId, user.userId);
    const span = query.to.getTime() - query.from.getTime();
    if (span <= 0) throw new BadRequestException('`from` must be before `to`');
    if (span > MAX_EXPORT_SPAN_MS) {
      throw new BadRequestException('A range can cover at most 31 days');
    }
    const timeZone = query.tz ?? 'UTC';
    try {
      new Intl.DateTimeFormat('en', { timeZone });
    } catch {
      throw new BadRequestException(`Unknown time zone "${timeZone}"`);
    }

    const batches = this.store.readingBatches(bmsId, query.from, query.to);
    const first = await batches.next();
    const csv = new BmsCsv(
      timeZone,
      first.done || first.value.length === 0
        ? { cells: 0, temperatures: [] }
        : BmsCsv.layoutFor(first.value[0]),
    );
    const day = (date: Date) => date.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bms-${bmsId}-${day(query.from)}-${day(query.to)}.csv"`,
    );
    // The byte-order mark makes Excel read the file as UTF-8 (°C).
    res.write('\uFEFF' + csv.header());
    if (!first.done) res.write(first.value.map((r) => csv.row(r)).join(''));
    for await (const batch of batches) {
      res.write(batch.map((r) => csv.row(r)).join(''));
    }
    res.end();
  }

  private async requireOwnedDevice(
    profileId: number,
    bmsId: number,
    userId: number,
  ): Promise<void> {
    const owned = await this.prisma.bmsDevice.count({
      where: {
        id: bmsId,
        inverterProfileId: profileId,
        inverterProfile: { userId },
      },
    });
    if (!owned) throw new NotFoundException('BMS not found');
  }

  /** 404s for another user's inverter, the same as for a missing one. */
  private async requireOwnedProfile(
    profileId: number,
    userId: number,
  ): Promise<void> {
    const owned = await this.prisma.inverterProfile.count({
      where: { id: profileId, userId },
    });
    if (!owned) throw new NotFoundException('Inverter profile not found');
  }
}
