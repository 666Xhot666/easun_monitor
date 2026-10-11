import { Global, Module } from '@nestjs/common';
import { ServerAccessController } from './server-access.controller';
import { ServerAccessService } from './server-access.service';
import { ServerAgentController } from './server-agent.controller';
import { ServerAgentService } from './server-agent.service';

/** @Global: sign-up claims the owner, and other modules check server access. */
@Global()
@Module({
  controllers: [ServerAccessController, ServerAgentController],
  providers: [ServerAccessService, ServerAgentService],
  exports: [ServerAccessService],
})
export class ServerMonitorModule {}
