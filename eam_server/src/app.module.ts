import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SolarModule } from './solar/solar.module';
import { HouseholdsModule } from './households/households.module';
import { BmsLatestModule } from './bms/bms-latest';
import { BmsModule } from './bms/bms.module';
import { TelegramModule } from './telegram/telegram.module';
import { InverterModule } from './inverter/inverter.module';
import { AuthModule } from './auth/auth.module';
import { SerialSniffModule } from './inverter/serial-sniff/serial-sniff.module';

@Module({
  imports: [
    // isGlobal: true — every module can inject ConfigService without
    // re-importing ConfigModule. Inside Docker, docker-compose.yml already
    // injects real process env vars, so there's no .env file to find here;
    // ConfigModule just falls through to process.env, which is exactly
    // what we want (container env always wins, nothing hardcoded).
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Registers SchedulerRegistry for DI. We don't use @Cron/@Interval here
    // (PollingService needs a runtime-configured interval), but the
    // registry itself still comes from this module.
    ScheduleModule.forRoot(),
    PrismaModule,
    HouseholdsModule,
    AuthModule,
    SerialSniffModule,
    InverterModule,
    SolarModule,
    BmsLatestModule,
    BmsModule,
    TelegramModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
