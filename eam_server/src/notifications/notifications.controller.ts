import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { NotificationSettingsService } from './notification-settings.service';
import { UpdateNotificationSettingsDto } from './update-notification-settings.dto';

/** The signed-in user's notification settings. */
@Controller('api/notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationsController {
  constructor(private readonly settings: NotificationSettingsService) {}

  @Get('settings')
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.get(user.userId);
  }

  @Put('settings')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateNotificationSettingsDto,
  ) {
    return this.settings.update(user.userId, body);
  }
}
