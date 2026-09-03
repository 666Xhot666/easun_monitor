import { Module } from '@nestjs/common';
import { InverterService } from './inverter.service';
import { PollingService } from './polling.service';

@Module({
  // PrismaModule is @Global, so PollingService can inject PrismaService
  // without InverterModule importing it explicitly.
  providers: [InverterService, PollingService],
  exports: [InverterService],
})
export class InverterModule {}
