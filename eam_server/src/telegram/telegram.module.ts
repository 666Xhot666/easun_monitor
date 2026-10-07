import { Module } from '@nestjs/common';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConfigService } from '@nestjs/config';
import { TelegramAlerts } from './telegram-alerts';
import { TelegramBot } from './telegram-bot';
import { TelegramSummary } from './telegram-summary';
import { HttpTelegramClient, TELEGRAM_CLIENT } from './telegram-client';
import { TelegramController } from './telegram.controller';
import { TelegramLinksService } from './telegram-links.service';

@Module({
  imports: [TelemetryModule, NotificationsModule],
  controllers: [TelegramController],
  providers: [
    TelegramLinksService,
    TelegramBot,
    TelegramAlerts,
    TelegramSummary,
    {
      provide: TELEGRAM_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('TELEGRAM_BOT_TOKEN');
        return token ? new HttpTelegramClient(token) : null;
      },
    },
  ],
  exports: [TelegramLinksService, TelegramBot, TelegramAlerts],
})
export class TelegramModule {}
