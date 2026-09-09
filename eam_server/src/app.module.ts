import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { InverterModule } from './inverter/inverter.module';
import { AuthModule } from './auth/auth.module';

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
    AuthModule,
    InverterModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
