import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ServerAlertsService } from './server-alerts.service';

/**
 * Server notices: the owner's limits and the recent notices.
 */
@Controller('api/server/alerts')
@UseGuards(AuthGuard('jwt'))
export class ServerAlertsController {
  constructor(private readonly alerts: ServerAlertsService) {}

  /**
   * The limits and the recent notices. Owner and viewers.
   */
  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.alerts.get(user.userId);
  }

  /**
   * New limits; checked by the service. Owner only.
   */
  @Put('limits')
  putLimits(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.alerts.putLimits(user.userId, body);
  }
}
