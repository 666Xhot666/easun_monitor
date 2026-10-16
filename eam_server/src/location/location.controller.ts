import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LocationService } from './location.service';

@Controller('api/location')
@UseGuards(AuthGuard('jwt'))
export class LocationController {
  constructor(private readonly location: LocationService) {}

  /** Where the server is, roughly, for the user to check and save. */
  @Get('detect')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  detect() {
    return this.location.detect();
  }
}
