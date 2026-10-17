import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { HouseholdsService } from '../households/households.service';
import { WeatherService } from './weather.service';

@Controller('api/inverter')
@UseGuards(AuthGuard('jwt'))
export class WeatherController {
  constructor(
    private readonly weather: WeatherService,
    private readonly households: HouseholdsService,
  ) {}

  /** Expected PV from the weather against what the array made: past week to tomorrow. */
  @Get(':profileId/solar-forecast')
  async solarForecast(
    @Param('profileId', ParseIntPipe) profileId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.households.requireProfile(profileId, user.userId, 'read');
    return this.weather.solarForecast(profileId, new Date());
  }
}
