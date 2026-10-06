import { Global, Module } from '@nestjs/common';
import { HouseholdsController } from './households.controller';
import { HouseholdsService } from './households.service';
import { InvitesService } from './invites.service';
import { MembersService } from './members.service';

/** @Global: every feature module checks household access. */
@Global()
@Module({
  controllers: [HouseholdsController],
  providers: [HouseholdsService, InvitesService, MembersService],
  exports: [HouseholdsService, InvitesService],
})
export class HouseholdsModule {}
