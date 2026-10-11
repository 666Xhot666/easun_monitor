import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ServerAccessController } from './server-access.controller';
import { ServerAccessService } from './server-access.service';
import { ServerAgentController } from './server-agent.controller';
import { ServerAlertsController } from './server-alerts.controller';
import { ServerAlertsService } from './server-alerts.service';
import { ServerAgentService } from './server-agent.service';
import { ServerFanController } from './server-fan.controller';
import { ServerFanService } from './server-fan.service';

/** @Global: sign-up claims the owner, and other modules check server access. */
@Global()
@Module({
  imports: [TelegramModule, NotificationsModule],
  controllers: [
    ServerAccessController,
    ServerAgentController,
    ServerFanController,
    ServerAlertsController,
  ],
  providers: [
    ServerAccessService,
    ServerAgentService,
    ServerFanService,
    ServerAlertsService,
  ],
  exports: [ServerAccessService],
})
export class ServerMonitorModule {}
