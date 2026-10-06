import { Module } from '@nestjs/common';
import { BmsDevicesController } from './bms-devices.controller';

@Module({
  controllers: [BmsDevicesController],
})
export class BmsModule {}
