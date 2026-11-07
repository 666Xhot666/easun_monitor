import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { BmsIngestService } from './bms-ingest.service';
import { BmsReadingDto } from './dto/bms-reading.dto';
import { BmsSettingsReportDto } from './dto/bms-settings-report.dto';

/**
 * Where BMS producers (the Mac reader, later an ESP32) post readings. Not a
 * user session: the bearer token is a device's ingest token, which can only
 * write that device's readings.
 */
@Controller('api/bms')
export class BmsIngestController {
  constructor(private readonly ingest: BmsIngestService) {}

  @Post('ingest')
  @HttpCode(202)
  async post(
    @Headers('authorization') authorization: string | undefined,
    @Body() reading: BmsReadingDto,
  ) {
    const device = await this.device(authorization);
    return this.ingest.ingest(device.id, reading);
  }

  /** The BMS's settings, sent by the reader once per connect. */
  @Post('ingest/settings')
  @HttpCode(202)
  async postSettings(
    @Headers('authorization') authorization: string | undefined,
    @Body() report: BmsSettingsReportDto,
  ) {
    const device = await this.device(authorization);
    await this.ingest.storeSettings(device.id, report);
    return {};
  }

  private async device(authorization: string | undefined) {
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    const device = token ? await this.ingest.deviceForToken(token) : null;
    if (!device) throw new UnauthorizedException('Unknown BMS ingest token');
    return device;
  }
}
