import { Global, Module } from '@nestjs/common';
import { ServerAccessController } from './server-access.controller';
import { ServerAccessService } from './server-access.service';

/** @Global: sign-up claims the owner, and other modules check server access. */
@Global()
@Module({
  controllers: [ServerAccessController],
  providers: [ServerAccessService],
  exports: [ServerAccessService],
})
export class ServerMonitorModule {}
