import { Module } from '@nestjs/common';
import { HouseholdsModule } from '../households/households.module';
import { OutageChecksService } from './outage-checks.service';
import { OutageReaderController } from './outage-reader.controller';
import { OutageSourcesController } from './outage-sources.controller';
import { OutageSourcesService } from './outage-sources.service';

@Module({
  imports: [HouseholdsModule],
  controllers: [OutageSourcesController, OutageReaderController],
  providers: [OutageSourcesService, OutageChecksService],
})
export class OutageModule {}
