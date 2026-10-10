import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { OutageChecksService } from './outage-checks.service';
import { OutageSourcesService } from './outage-sources.service';
import { PostOutageCheckDto } from './dto/post-outage-check.dto';
import { PutSiteStreetsDto } from './dto/put-site-streets.dto';

/** Where the outage schedule reader asks what to check and sends the site's street lists. Not a user session: the bearer token is an outage source's reader token. */
@Controller('api/outage/reader')
export class OutageReaderController {
  constructor(
    private readonly sources: OutageSourcesService,
    private readonly checks: OutageChecksService,
  ) {}

  private async source(authorization: string | undefined) {
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    const source = token ? await this.sources.sourceForToken(token) : null;
    if (!source) {
      throw new UnauthorizedException('Unknown outage reader token');
    }
    return source;
  }

  @Get('source')
  getSource(@Headers('authorization') authorization: string | undefined) {
    return this.source(authorization);
  }

  @Put('streets')
  async putStreets(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: PutSiteStreetsDto,
  ) {
    await this.source(authorization);
    return this.sources.saveStreets(dto);
  }

  /** One check of the site, successful or not. */
  @Post('checks')
  @HttpCode(202)
  async postCheck(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: PostOutageCheckDto,
  ) {
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    const sourceId = token ? await this.checks.sourceIdForToken(token) : null;
    if (sourceId === null) {
      throw new UnauthorizedException('Unknown outage reader token');
    }
    return this.checks.ingest(sourceId, dto);
  }
}
