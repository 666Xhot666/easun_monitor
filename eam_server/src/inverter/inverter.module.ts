import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InverterController } from './inverter.controller';
import { InverterService } from './inverter.service';
import { LoggerAddressPolicy } from './logger-address.policy';
import { PollingService } from './polling.service';

@Module({
  // PrismaModule is @Global, so PollingService/InverterController can
  // inject PrismaService without InverterModule importing it explicitly.
  controllers: [InverterController],
  providers: [
    InverterService,
    PollingService,
    {
      provide: LoggerAddressPolicy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new LoggerAddressPolicy({
          allowPublic: config.get<string>('ALLOW_PUBLIC_LOGGER_HOSTS') === 'true',
        }),
    },
  ],
  exports: [InverterService],
})
export class InverterModule {}
