import {
  Body,
  Controller,
  Get,
  Headers,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { OutageSourcesService } from './outage-sources.service';
import { PutSiteStreetsDto } from './dto/put-site-streets.dto';

/** Where the outage schedule reader asks what to check and sends the site's street lists. Not a user session: the bearer token is an outage source's reader token. */
@Controller('api/outage/reader')
export class OutageReaderController {
  constructor(private readonly sources: OutageSourcesService) {}

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
}
