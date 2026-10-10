import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { OutageSourcesService } from './outage-sources.service';
import { PutOutageSourceDto } from './dto/put-outage-source.dto';

/** An inverter's outage schedule source (its DTEK address), and the site's city and street lists for picking one. */
@Controller('api')
@UseGuards(AuthGuard('jwt'))
export class OutageSourcesController {
  constructor(private readonly sources: OutageSourcesService) {}

  @Get('inverter/profiles/:profileId/outage-source')
  get(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sources.get(profileId, user.userId);
  }

  /** Creates the source (returning the reader token once) or changes it. */
  @Put('inverter/profiles/:profileId/outage-source')
  put(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PutOutageSourceDto,
  ) {
    return this.sources.put(profileId, user.userId, dto);
  }

  /** A new reader token, shown once; the old one stops working. */
  @Post('inverter/profiles/:profileId/outage-source/token')
  replaceToken(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sources.replaceToken(profileId, user.userId);
  }

  @Delete('inverter/profiles/:profileId/outage-source')
  @HttpCode(204)
  async remove(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.sources.remove(profileId, user.userId);
  }

  @Get('outage/cities')
  cities() {
    return this.sources.cities();
  }

  @Get('outage/streets')
  streets(@Query('city') city: string) {
    if (typeof city !== 'string' || city === '') {
      throw new BadRequestException('city is required');
    }
    return this.sources.streets(city);
  }
}
