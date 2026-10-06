import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramLinksService } from './telegram-links.service';

@Module({
  controllers: [TelegramController],
  providers: [TelegramLinksService],
  exports: [TelegramLinksService],
})
export class TelegramModule {}
