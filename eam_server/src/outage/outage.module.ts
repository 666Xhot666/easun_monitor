import { Module } from '@nestjs/common';
import { HouseholdsModule } from '../households/households.module';
import { OutageReaderController } from './outage-reader.controller';
import { OutageSourcesController } from './outage-sources.controller';
import { OutageSourcesService } from './outage-sources.service';

@Module({
  imports: [HouseholdsModule],
  controllers: [OutageSourcesController, OutageReaderController],
  providers: [OutageSourcesService],
})
export class OutageModule {}
