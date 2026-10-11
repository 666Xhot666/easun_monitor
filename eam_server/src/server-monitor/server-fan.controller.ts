import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ServerFanService } from './server-fan.service';

/**
 * The host's fan: the owner's settings, and what the agent last did with them.
 */
@Controller('api/server/fan')
@UseGuards(AuthGuard('jwt'))
export class ServerFanController {
  constructor(private readonly fan: ServerFanService) {}

  /**
   * The settings and the agent's last report on the fan. Owner and viewers.
   */
  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.fan.get(user.userId);
  }

  /**
   * New settings; checked by the service. Owner only.
   */
  @Put()
  put(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.fan.put(user.userId, body);
  }
}
