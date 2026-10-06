import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBmsDeviceDto } from './dto/create-bms-device.dto';
import { newIngestToken } from './ingest-token';

/** Everything about a device but its token hash. */
export const BMS_DEVICE_FIELDS = {
  id: true,
  name: true,
  sourceType: true,
  bluetoothId: true,
  lastSeenAt: true,
  createdAt: true,
  inverterProfileId: true,
} as const;

/** The BMS devices of one of the user's inverters. */
@Controller('api/inverter/profiles/:profileId/bms')
@UseGuards(AuthGuard('jwt'))
export class BmsDevicesController {
  constructor(private readonly prisma: PrismaService) {}

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
