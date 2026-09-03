import { Module } from '@nestjs/common';
import { InverterController } from './inverter.controller';
import { InverterService } from './inverter.service';
import { PollingService } from './polling.service';

@Module({
  // PrismaModule is @Global, so PollingService/InverterController can
  // inject PrismaService without InverterModule importing it explicitly.
  controllers: [InverterController],
  providers: [InverterService, PollingService],
  exports: [InverterService],
})
export class InverterModule {}
