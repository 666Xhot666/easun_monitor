import {
  BadRequestException,
  Body,
  ConflictException,
  ServiceUnavailableException,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerLinks } from './link/logger-links';
import { RegisterMap, RegisterValueError } from './registers/register-map';
import { LoggerUnavailableError } from './link/logger-link';
import { LoggerFrameError } from './protocol/logger-frame';
import { SettingsRuleError, SettingsService } from './settings.service';
import { settingsConstraints } from './settings-rules/smg-ii.settings-rules';
import { SMG_II_PANEL_SETTINGS } from './registers/smg-ii.panel-settings';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { LoggerAddressPolicy } from './logger-address.policy';
import { PollingService } from './polling.service';
import { PairTestDto } from './dto/pair-test.dto';
import { SetupInverterDto } from './dto/setup-inverter.dto';
import { UpdateInverterDto } from './dto/update-inverter.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { TelemetryStore } from '../telemetry/telemetry.store';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

/** The Wi-Fi Plug Pro's TCP port, used when none is given. */
const DEFAULT_LOGGER_PORT = 8899;
const DEFAULT_HISTORY_POINTS = 300;
const DEFAULT_HISTORY_SPAN_MS = 60 * 60 * 1000;
/** Longest range one history request may cover. */
const MAX_HISTORY_SPAN_MS = 5 * 366 * 24 * 60 * 60 * 1000;

@Controller('api/inverter')
@UseGuards(AuthGuard('jwt'))
export class InverterController {
  private readonly logger = new Logger(InverterController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LoggerLinks,
    private readonly pollingService: PollingService,
    private readonly addressPolicy: LoggerAddressPolicy,
    private readonly telemetry: TelemetryStore,
    private readonly registers: RegisterMap,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The Register map as metadata: every register's name, label, unit,
   * scale, enum options, group and writability. The frontend renders
   * readings and settings from this instead of its own copy.
   */
  @Get('registers')
  listRegisters() {
    return this.registers.list();
  }

  /** Settings that exist only on the inverter's panel (no register). */
  @Get('panel-settings')
  listPanelSettings() {
    return SMG_II_PANEL_SETTINGS;
  }

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
    await this.addressPolicy.assertAllowed(dto.ipAddress);
    const profile = await this.rejectDuplicateAddress(() =>
      this.prisma.inverterProfile.create({
        data: {
          userId: user.userId,
          name: dto.name,
          ipAddress: dto.ipAddress,
          port: dto.port ?? DEFAULT_LOGGER_PORT,
          ratedPowerWatts: dto.ratedPowerWatts,
          batteryNominalVoltage: dto.batteryNominalVoltage,
          batteryCapacityAh: dto.batteryCapacityAh,
          batteryType: dto.batteryType,
          lowBatteryCutoffVoltage: dto.lowBatteryCutoffVoltage ?? null,
          bulkChargeVoltage: dto.bulkChargeVoltage ?? null,
          floatChargeVoltage: dto.floatChargeVoltage ?? null,
        },
      }),
    );

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
    if (dto.ipAddress !== undefined) {
      await this.addressPolicy.assertAllowed(dto.ipAddress);
    }

    const profile = await this.rejectDuplicateAddress(() =>
      this.prisma.inverterProfile.update({ where: { id }, data: dto }),
    );

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
    await this.addressPolicy.assertAllowed(dto.ipAddress);
    try {
      const { latencyMs, sampledRegister } = await this.links.probe(
        dto.ipAddress,
        dto.port ?? DEFAULT_LOGGER_PORT,
      );
      return { success: true as const, latencyMs, sampledParameter: sampledRegister };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 400, not 500: a wrong or unreachable address is an expected,
      // user-actionable outcome of this endpoint, not a server fault.
      throw new BadRequestException(`Couldn't verify the logger at ${dto.ipAddress}: ${message}`);
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

    const latest = await this.telemetry.latest(profileId);

    if (!latest) {
      throw new NotFoundException('No inverter readings recorded yet');
    }

    const payload = latest.payload as Record<string, number>;
    return {
      ...latest,
      alerts: {
        faults: this.registers.activeFlags('FaultCode', payload.FaultCode ?? 0),
        warnings: this.registers.activeFlags('WarningCode', payload.WarningCode ?? 0),
      },
    };
  }

  /** Live link state for one inverter's logger, as seen by the poller. */
  @Get(':profileId/status')
  async getStatus(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const profile = await this.requireOwnedProfile(profileId, user.userId);
    const status = this.links.status(profile.ipAddress, profile.port);
    const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
    return {
      state: status.state,
      lastError: status.lastError,
      lastSuccessAt: iso(status.lastSuccessAt),
      retryAt: iso(status.retryAt),
    };
  }

  /**
   * Averaged history for one inverter over a time range, oldest first,
   * downsampled to at most `points` buckets (see TelemetryStore.history).
   */
  @Get(':profileId/history')
  async getHistory(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Query() query: HistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwnedProfile(profileId, user.userId);

    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_HISTORY_SPAN_MS);
    const span = to.getTime() - from.getTime();
    if (span <= 0) {
      throw new BadRequestException('`from` must be before `to`');
    }
    if (span > MAX_HISTORY_SPAN_MS) {
      throw new BadRequestException('A history range can cover at most 5 years');
    }

    return this.telemetry.history(profileId, {
      from,
      to,
      maxPoints: query.points ?? DEFAULT_HISTORY_POINTS,
      fields: query.fields,
    });
  }

  // -----------------------------------------------------------------
  // Settings — read from and written to the inverter itself.
  // -----------------------------------------------------------------

  /** The inverter's settings, cached for a few minutes. */
  @Get(':profileId/settings')
  async getSettings(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const profile = await this.requireOwnedProfile(profileId, user.userId);
    return this.deviceCall(() => this.settings.get(profile));
  }

  /**
   * What settings changes must respect for this installation: ranges and
   * defaults for its battery, and the rules between settings. Comes from
   * the profile, not the device.
   */
  @Get(':profileId/settings/constraints')
  async getSettingsConstraints(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return settingsConstraints(await this.requireOwnedProfile(profileId, user.userId));
  }

  /** Re-reads the settings from the inverter now. */
  @Post(':profileId/settings/refresh')
  async refreshSettings(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const profile = await this.requireOwnedProfile(profileId, user.userId);
    return this.deviceCall(() => this.settings.refresh(profile));
  }

  /** Writes changed settings and returns what the inverter then holds. */
  @Patch(':profileId/settings')
  async updateSettings(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const profile = await this.requireOwnedProfile(profileId, user.userId);
    const entries = Object.entries(dto.changes);
    if (entries.length === 0) {
      throw new BadRequestException('No settings to change');
    }
    if (entries.some(([, value]) => typeof value !== 'number')) {
      throw new BadRequestException('Every setting value must be a number');
    }
    try {
      return await this.deviceCall(() =>
        this.settings.apply(profile, dto.changes, dto.acknowledgeWarnings),
      );
    } catch (error) {
      if (!(error instanceof SettingsRuleError)) throw error;
      const { errors, warnings } = error.check;
      const lines = Object.entries(Object.keys(errors).length ? errors : warnings).map(
        ([name, messages]) =>
          `${this.registers.get(name)?.label ?? name}: ${messages.join('; ')}`,
      );
      throw new BadRequestException({
        message: lines.join('\n'),
        errors,
        warnings,
        warningsNeedAcknowledgement: Object.keys(errors).length === 0,
      });
    }
  }

  /** Maps device-side failures to HTTP errors with the device's message. */
  private async deviceCall<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof RegisterValueError) throw new BadRequestException(error.message);
      if (error instanceof LoggerFrameError) throw new ConflictException(error.message);
      if (error instanceof LoggerUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
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

  /** Maps the one-profile-per-logger constraint to a user-facing 409. */
  private async rejectDuplicateAddress<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          'This logger address and port is already paired with an inverter profile',
        );
      }
      throw error;
    }
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
      this.logger.error(
        `Failed to sync polling after a profile change: ${message}`,
      );
    }
  }
}
