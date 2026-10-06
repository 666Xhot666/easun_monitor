import { Module } from '@nestjs/common';
import { BmsDevicesController } from './bms-devices.controller';
import { BmsIngestController } from './bms-ingest.controller';
import { BmsIngestService } from './bms-ingest.service';
import { BmsStore } from './bms.store';

@Module({
  controllers: [BmsDevicesController, BmsIngestController],
  providers: [BmsIngestService, BmsStore],
})
export class BmsModule {}
