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
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    const device = token ? await this.ingest.deviceForToken(token) : null;
    if (!device) throw new UnauthorizedException('Unknown BMS ingest token');
    return this.ingest.ingest(device.id, reading);
  }
}
