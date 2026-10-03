import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { SerialCapture } from './serial-capture';
import { CaptureStore } from './capture-store';
import { summarizeCapture } from './capture-summary';
import { GroundTruthStore } from './ground-truth-store';
import { suggestNames } from './name-suggestions';
import { RegisterMap } from '../registers/register-map';
import { SMG_II_REGISTERS } from '../registers/smg-ii.registers';
import { settingsConstraints } from '../settings-rules/smg-ii.settings-rules';

class StartCaptureDto {
  @IsString()
  @IsNotEmpty()
  rxPath!: string;

  @IsString()
  @IsNotEmpty()
  txPath!: string;

  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(4000000)
  rxBaud?: number;

  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(4000000)
  txBaud?: number;
}

/**
 * Dev-only API for the two-tap serial capture; exists only when NODE_ENV is not production AND DEV_SERIAL_SNIFF=true (otherwise 404), and only for signed-in users.
 */
@Controller('api/dev/serial')
@UseGuards(AuthGuard('jwt'))
export class SerialSniffController {
  private readonly registers = new RegisterMap(SMG_II_REGISTERS);

  constructor(
    private readonly capture: SerialCapture,
    private readonly store: CaptureStore,
    private readonly groundTruth: GroundTruthStore,
    private readonly config: ConfigService,
  ) {}

  private assertEnabled(): void {
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      this.config.get<string>('DEV_SERIAL_SNIFF') !== 'true'
    ) {
      throw new NotFoundException();
    }
  }

  private baud(key: string): number {
    const value = Number(this.config.get<string>(key));
    return Number.isInteger(value) && value > 0 ? value : 9600;
  }

  @Get()
  read(@Query('since') since = '0') {
    this.assertEnabled();
    return {
      ...this.capture.status(),
      defaults: {
        rxPath: this.config.get<string>('SERIAL_RX_PORT') ?? null,
        txPath: this.config.get<string>('SERIAL_TX_PORT') ?? null,
        rxBaud: this.baud('SERIAL_RX_BAUD'),
        txBaud: this.baud('SERIAL_TX_BAUD'),
      },
      records: this.capture.records(Number(since) || 0),
    };
  }

  @Post('start')
  async start(@Body() dto: StartCaptureDto) {
    this.assertEnabled();
    await this.capture.start({
      rxPath: dto.rxPath,
      txPath: dto.txPath,
      rxBaud: dto.rxBaud ?? this.baud('SERIAL_RX_BAUD'),
      txBaud: dto.txBaud ?? this.baud('SERIAL_TX_BAUD'),
    });
    return this.capture.status();
  }

  @Post('stop')
  async stop() {
    this.assertEnabled();
    await this.capture.stop();
    return this.capture.status();
  }

  @Get('captures')
  captures() {
    this.assertEnabled();
    return this.store.list();
  }

  /** Hand-written reference readings, newest first. */
  @Get('ground-truth')
  groundTruthSnapshots() {
    this.assertEnabled();
    return this.groundTruth.list();
  }

  /**
   * A capture's summary; with `groundTruth`, also suggested reference
   * fields for its unknown addresses.
   */
  @Get('captures/:id/summary')
  summary(
    @Param('id') id: string,
    @Query('batteryVoltage') batteryVoltage?: string,
    @Query('groundTruth') groundTruthId?: string,
  ) {
    this.assertEnabled();
    const capture = this.store.read(id);
    if (!capture) {
      throw new NotFoundException('No such capture');
    }
    const bounds = batteryVoltage
      ? settingsConstraints({ batteryNominalVoltage: Number(batteryVoltage), batteryType: '' }).bounds
      : {};
    const snapshot = groundTruthId ? this.groundTruth.read(groundTruthId) : null;
    if (groundTruthId && !snapshot) {
      throw new NotFoundException('No such ground-truth snapshot');
    }
    return {
      meta: capture.meta,
      ...summarizeCapture(this.registers, capture.records, bounds),
      ...(snapshot
        ? { groundTruth: snapshot, suggestions: suggestNames(this.registers, capture.records, snapshot) }
        : {}),
    };
  }
}
