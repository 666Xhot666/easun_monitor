import { Module } from '@nestjs/common';
import { HouseholdsModule } from '../households/households.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { OutageAvailability } from './outage-availability.service';
import { OutageChecksService } from './outage-checks.service';
import { OutageForecastService } from './outage-forecast.service';
import { OutageReminders } from './outage-reminders.service';
import { OutageReaderController } from './outage-reader.controller';
import { OutageSourcesController } from './outage-sources.controller';
import { OutageSourcesService } from './outage-sources.service';

@Module({
  imports: [
    HouseholdsModule,
    TelegramModule,
    NotificationsModule,
    TelemetryModule,
  ],
  controllers: [OutageSourcesController, OutageReaderController],
  providers: [
    OutageSourcesService,
    OutageChecksService,
    OutageForecastService,
    OutageReminders,
    OutageAvailability,
  ],
  exports: [OutageForecastService],
})
export class OutageModule {}
