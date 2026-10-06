import { Global, Module } from '@nestjs/common';
import { HouseholdsService } from './households.service';

/** @Global: every feature module checks household access. */
@Global()
@Module({
  providers: [HouseholdsService],
  exports: [HouseholdsService],
})
export class HouseholdsModule {}
