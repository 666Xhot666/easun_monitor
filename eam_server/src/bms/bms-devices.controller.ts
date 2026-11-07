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
import { ReadingsQueryDto } from '../inverter/dto/readings-query.dto';
import { HistoryQueryDto } from '../inverter/dto/history-query.dto';
import { SMG_II_READINGS } from '../inverter/readings/smg-ii.readings';
import { WiringQueryDto } from './dto/wiring-query.dto';
import { fitWiringDrop, type WiringFit } from './wiring-drop';
import { ReadingsExportQueryDto } from '../inverter/dto/readings-export-query.dto';
import { BmsCsv } from './bms-csv';
import { languageOr } from '../i18n/languages';
import {
  HouseholdsService,
  type Access,
} from '../households/households.service';
import { BmsIngestService } from './bms-ingest.service';
import { BmsStore } from './bms.store';
import { CreateBmsDeviceDto } from './dto/create-bms-device.dto';
import { UpdateBmsDeviceDto } from './dto/update-bms-device.dto';
import { newIngestToken } from './ingest-token';
import { localized } from '../i18n/localized';
import {
  DEFAULT_HISTORY_POINTS,
  DEFAULT_HISTORY_SPAN_MS,
  MAX_EXPORT_SPAN_MS,
  MAX_HISTORY_SPAN_MS,
  DAY_MS,
  STALE_AFTER_MS,
  WIRING_TREND_DAYS,
} from './constants';

/** Everything about a device but its token hash. */
export const BMS_DEVICE_FIELDS = {
  id: true,
  name: true,
  sourceType: true,
  bluetoothId: true,
  lastSeenAt: true,
  useForEnergyFlow: true,
  cellLowAlertV: true,
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
    private readonly households: HouseholdsService,
  ) {}

  @Get()
  async list(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedProfile(profileId, user.userId, 'read');
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
    await this.requireOwnedProfile(profileId, user.userId, 'write');
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
    await this.requireOwnedDevice(profileId, bmsId, user.userId, 'write');
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
    await this.requireOwnedDevice(profileId, bmsId, user.userId, 'write');
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
    await this.requireOwnedDevice(profileId, bmsId, user.userId, 'write');
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
    await this.requireOwnedDevice(profileId, bmsId, user.userId, 'read');
    const reading =
      this.ingest.latestFor(bmsId)?.reading ?? (await this.store.newest(bmsId));
    if (!reading) throw new NotFoundException(localized('noBmsReading'));
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

  /** The BMS's own settings as last reported: read-only, nothing here changes them. */
  @Get(':bmsId/settings')
  async settings(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Param('bmsId', ParseIntPipe) bmsId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedDevice(profileId, bmsId, user.userId, 'read');
    const row = await this.prisma.bmsDevice.findUnique({
      where: { id: bmsId },
      select: { settings: true, settingsAt: true },
    });
    if (!row?.settings || !row.settingsAt)
      throw new NotFoundException(localized('noBmsSettings'));
    return {
      ...(row.settings as object),
      receivedAt: row.settingsAt.toISOString(),
    };
  }

  /**
   * How the inverter's battery voltage relates to the BMS's, fitted over the
   * last `days`: path resistance and calibration offset, overall and per
   * week. A fit is null until the currents spread enough to tell them apart.
   */
  @Get(':bmsId/wiring')
  async wiring(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Param('bmsId', ParseIntPipe) bmsId: number,
    @Query() query: WiringQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedDevice(profileId, bmsId, user.userId, 'read');
    const voltage = SMG_II_READINGS.source('batteryVoltage');
    const current = SMG_II_READINGS.source('batteryCurrent');
    if (
      !voltage ||
      !current ||
      !('register' in voltage) ||
      !('register' in current)
    )
      return { overall: null, weeks: [] };
    const to = new Date();
    const from = new Date(to.getTime() - query.days * DAY_MS);
    const pairs = await this.store.voltagePairs(
      bmsId,
      profileId,
      { voltage: voltage.register, current: current.register },
      from,
      to,
    );
    const overall = fitWiringDrop(pairs);
    if (!overall) return { overall: null, weeks: [] };
    const weeks: { from: string; fit: WiringFit }[] = [];
    for (
      let start = from.getTime();
      start < to.getTime();
      start += WIRING_TREND_DAYS * DAY_MS
    ) {
      const end = start + WIRING_TREND_DAYS * DAY_MS;
      const fit = fitWiringDrop(
        pairs.filter((p) => p.at.getTime() >= start && p.at.getTime() < end),
      );
      if (fit) weeks.push({ from: new Date(start).toISOString(), fit });
    }
    return { overall, weeks };
  }

  /** Averaged history over a range, like the inverter's history. */
  /** Stored readings of a range, newest first, a page at a time. */
  @Get(':bmsId/readings')
  async readings(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Param('bmsId', ParseIntPipe) bmsId: number,
    @Query() query: ReadingsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedDevice(profileId, bmsId, user.userId, 'read');
    if (query.to <= query.from)
      throw new BadRequestException(localized('fromBeforeTo'));
    return this.store.readings(bmsId, {
      from: query.from,
      to: query.to,
      limit: query.limit ?? 100,
      before: query.before,
    });
  }

  @Get(':bmsId/history')
  async history(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Param('bmsId', ParseIntPipe) bmsId: number,
    @Query() query: HistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedDevice(profileId, bmsId, user.userId, 'read');
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_HISTORY_SPAN_MS);
    const span = to.getTime() - from.getTime();
    if (span <= 0) throw new BadRequestException(localized('fromBeforeTo'));
    if (span > MAX_HISTORY_SPAN_MS) {
      throw new BadRequestException(localized('historyTooLong', { years: 5 }));
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
    await this.requireOwnedDevice(profileId, bmsId, user.userId, 'read');
    const span = query.to.getTime() - query.from.getTime();
    if (span <= 0) throw new BadRequestException(localized('fromBeforeTo'));
    if (span > MAX_EXPORT_SPAN_MS) {
      throw new BadRequestException(localized('rangeTooLong', { days: 31 }));
    }
    const timeZone = query.tz ?? 'UTC';
    try {
      new Intl.DateTimeFormat('en', { timeZone });
    } catch {
      throw new BadRequestException(
        localized('unknownTimeZone', { zone: timeZone }),
      );
    }

    const batches = this.store.readingBatches(bmsId, query.from, query.to);
    const first = await batches.next();
    const csv = new BmsCsv(
      timeZone,
      first.done || first.value.length === 0
        ? { cells: 0, temperatures: [] }
        : BmsCsv.layoutFor(first.value[0]),
      languageOr(query.lang),
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

  /** The profile's household rules apply to its BMS devices. */
  private async requireOwnedDevice(
    profileId: number,
    bmsId: number,
    userId: number,
    access: Access,
  ): Promise<void> {
    await this.households.requireProfile(profileId, userId, access);
    const exists = await this.prisma.bmsDevice.count({
      where: { id: bmsId, inverterProfileId: profileId },
    });
    if (!exists) throw new NotFoundException(localized('bmsNotFound'));
  }

  /** 404s for another user's inverter, the same as for a missing one. */
  private async requireOwnedProfile(
    profileId: number,
    userId: number,
    access: Access,
  ): Promise<void> {
    await this.households.requireProfile(profileId, userId, access);
  }
}
