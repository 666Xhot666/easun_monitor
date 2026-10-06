import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramBot } from './telegram-bot';
import { HttpTelegramClient, TELEGRAM_CLIENT } from './telegram-client';
import { TelegramController } from './telegram.controller';
import { TelegramLinksService } from './telegram-links.service';

@Module({
  controllers: [TelegramController],
  providers: [
    TelegramLinksService,
    TelegramBot,
    {
      provide: TELEGRAM_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('TELEGRAM_BOT_TOKEN');
        return token ? new HttpTelegramClient(token) : null;
      },
    },
  ],
  exports: [TelegramLinksService, TelegramBot],
})
export class TelegramModule {}
