import { Module } from '@nestjs/common';
import { HouseholdsModule } from '../households/households.module';
import { TelegramModule } from '../telegram/telegram.module';
import { OutageChecksService } from './outage-checks.service';
import { OutageForecastService } from './outage-forecast.service';
import { OutageReaderController } from './outage-reader.controller';
import { OutageSourcesController } from './outage-sources.controller';
import { OutageSourcesService } from './outage-sources.service';

@Module({
  imports: [HouseholdsModule, TelegramModule],
  controllers: [OutageSourcesController, OutageReaderController],
  providers: [OutageSourcesService, OutageChecksService, OutageForecastService],
  exports: [OutageForecastService],
})
export class OutageModule {}
