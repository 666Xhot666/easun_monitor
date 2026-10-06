import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { BmsDevicesController } from './bms-devices.controller';
import { BmsIngestController } from './bms-ingest.controller';
import { BmsIngestService } from './bms-ingest.service';
import { BmsStore } from './bms.store';

@Module({
  imports: [TelegramModule],
  controllers: [BmsDevicesController, BmsIngestController],
  providers: [BmsIngestService, BmsStore],
})
export class BmsModule {}
