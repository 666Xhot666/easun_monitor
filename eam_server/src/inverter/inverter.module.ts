import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { InverterController } from './inverter.controller';
import { LOGGER_TRANSPORT_FACTORY, LoggerLinks } from './link/logger-links';
import { TcpLoggerTransport } from './link/tcp-logger-transport';
import { LoggerAddressPolicy } from './logger-address.policy';
import { PollingService } from './polling.service';
import { RegisterMap } from './registers/register-map';
import { SettingsService } from './settings.service';
import { SMG_II_REGISTERS } from './registers/smg-ii.registers';

@Module({
  // PrismaModule is @Global, so services here can inject PrismaService
  // without importing it explicitly.
  imports: [TelemetryModule],
  controllers: [InverterController],
  providers: [
    PollingService,
    LoggerLinks,
    SettingsService,
    { provide: RegisterMap, useValue: new RegisterMap(SMG_II_REGISTERS) },
    {
      provide: LOGGER_TRANSPORT_FACTORY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const timeoutMs = Number(config.get<string>('INVERTER_TIMEOUT_MS') ?? 3000);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw new Error(`INVERTER_TIMEOUT_MS must be a positive number of milliseconds`);
        }
        return (host: string, port: number) => new TcpLoggerTransport({ host, port, timeoutMs });
      },
    },
    {
      provide: LoggerAddressPolicy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new LoggerAddressPolicy({
          allowPublic: config.get<string>('ALLOW_PUBLIC_LOGGER_HOSTS') === 'true',
        }),
    },
  ],
  exports: [RegisterMap],
})
export class InverterModule {}
