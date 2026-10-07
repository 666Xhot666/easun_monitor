import { Module } from '@nestjs/common';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationSettingsService],
  exports: [NotificationSettingsService],
})
export class NotificationsModule {}
