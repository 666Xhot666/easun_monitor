import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InverterService } from './inverter.service';
import { PollingService } from './polling.service';
import { PairTestDto } from './dto/pair-test.dto';
import { SetupInverterDto } from './dto/setup-inverter.dto';
import { UpdateInverterDto } from './dto/update-inverter.dto';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

// Capped rather than unbounded — this backs a chart, not a full export, and
// an unbounded `findMany` would grow linearly with how long the poller has
// been running.
const HISTORY_LIMIT = 100;

@Controller('api/inverter')
@UseGuards(AuthGuard('jwt'))
export class InverterController {
  private readonly logger = new Logger(InverterController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inverterService: InverterService,
    private readonly pollingService: PollingService,
  ) {}

  // -----------------------------------------------------------------
  // Profile management — a user can pair more than one inverter, so
  // every one of these is scoped to (and ownership-checked against)
  // the calling user rather than assuming a single global profile.
  // -----------------------------------------------------------------

  /** All inverters this user has paired, most recently updated first. */
  @Get('profiles')
  async listProfiles(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.inverterProfile.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  @Get('profiles/:id')
  async getProfileById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requireOwnedProfile(id, user.userId);
  }

  /**
   * Pairs a *new* inverter. Always creates — a user with an existing
   * profile who wants to add a second (or third) device calls this again
   * rather than it silently overwriting their first one; editing an
   * existing profile goes through `PATCH /profiles/:id` instead.
   */
  @Post('setup')
  async setup(
    @Body() dto: SetupInverterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const profile = await this.prisma.inverterProfile.create({
      data: {
        userId: user.userId,
        name: dto.name,
        ipAddress: dto.ipAddress,
        port: dto.port ?? 8899,
        ratedPowerWatts: dto.ratedPowerWatts,
        batteryNominalVoltage: dto.batteryNominalVoltage,
        batteryCapacityAh: dto.batteryCapacityAh,
        batteryType: dto.batteryType,
        lowBatteryCutoffVoltage: dto.lowBatteryCutoffVoltage ?? null,
        bulkChargeVoltage: dto.bulkChargeVoltage ?? null,
        floatChargeVoltage: dto.floatChargeVoltage ?? null,
      },
    });

    await this.syncPollingBestEffort();
    return profile;
  }

  @Patch('profiles/:id')
  async updateProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInverterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedProfile(id, user.userId);

    const profile = await this.prisma.inverterProfile.update({
      where: { id },
      data: dto,
    });

    await this.syncPollingBestEffort();
    return profile;
  }

  /**
   * Un-pairs an inverter. Its past readings are kept (InverterLog.
   * inverterProfileId is nullable and set to SET NULL on delete) rather
   * than deleted along with it — removing a device from active polling
   * shouldn't destroy its history.
   */
  @Delete('profiles/:id')
  async deleteProfile(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedProfile(id, user.userId);
    await this.prisma.inverterProfile.delete({ where: { id } });
    await this.syncPollingBestEffort();
    return { success: true as const };
  }

  /**
   * One-off connectivity check used by the setup wizard's "Verify Logger"
   * button, before anything is persisted — lets the user confirm the IP is
   * right without committing an InverterProfile that then fails on the
   * first poll cycle. Not profile-scoped: nothing is saved yet at this
   * point.
   */
  @Post('pair/test')
  async testPairing(@Body() dto: PairTestDto) {
    try {
      return await this.inverterService.testConnection(dto.ipAddress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 400, not 500 — a failed handshake against a wrong/unreachable IP is
      // an expected, user-actionable outcome of this endpoint, not a
      // server fault.
      throw new BadRequestException(
        `Couldn't verify the logger at ${dto.ipAddress}: ${message}`,
      );
    }
  }

  // -----------------------------------------------------------------
  // Telemetry — scoped to one specific paired inverter.
  // -----------------------------------------------------------------

  /**
   * Most recent polled snapshot for one inverter. 404s (rather than
   * returning null) both when the profile isn't this user's and when no
   * reading has landed for it yet, so the frontend can't distinguish "not
   * yours" from "no data" — same non-leaking shape either way.
   */
  @Get(':profileId/latest')
  async getLatest(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedProfile(profileId, user.userId);

    const latest = await this.prisma.inverterLog.findFirst({
      where: { inverterProfileId: profileId },
      orderBy: { timestamp: 'desc' },
    });

    if (!latest) {
      throw new NotFoundException('No inverter readings recorded yet');
    }

    return latest;
  }

  /**
   * Last `HISTORY_LIMIT` snapshots for one inverter, chronological
   * (oldest → newest) so a chart can plot the array directly without
   * re-sorting.
   */
  @Get(':profileId/history')
  async getHistory(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedProfile(profileId, user.userId);

    const rows = await this.prisma.inverterLog.findMany({
      where: { inverterProfileId: profileId },
      orderBy: { timestamp: 'desc' },
      take: HISTORY_LIMIT,
    });

    return rows.reverse();
  }

  // -----------------------------------------------------------------

  private async requireOwnedProfile(id: number, userId: number) {
    const profile = await this.prisma.inverterProfile.findFirst({
      where: { id, userId },
    });
    if (!profile) {
      // Same 404 whether the id doesn't exist at all or belongs to someone
      // else — doesn't confirm to a caller that a given id exists but
      // isn't theirs.
      throw new NotFoundException('No such inverter profile');
    }
    return profile;
  }

  /**
   * The profile write itself is already committed by the time this runs;
   * a failure here shouldn't make the write look failed to the caller
   * (they'd retry into a duplicate/conflicting state) — log and move on,
   * same philosophy as PollingService's own per-poll error handling. The
   * next scheduled sync (or the next mutation) will pick up the change.
   */
  private async syncPollingBestEffort(): Promise<void> {
    try {
      await this.pollingService.syncProfiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to sync polling after a profile change: ${message}`);
    }
  }
}
