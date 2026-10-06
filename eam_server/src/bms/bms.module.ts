import { Module } from '@nestjs/common';
import { BmsDevicesController } from './bms-devices.controller';
import { BmsIngestController } from './bms-ingest.controller';
import { BmsIngestService } from './bms-ingest.service';

@Module({
  controllers: [BmsDevicesController, BmsIngestController],
  providers: [BmsIngestService],
})
export class BmsModule {}
