import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { parseHostSample } from './parse-sample';
import { ServerAgentService } from './server-agent.service';
import { ServerAlertsService } from './server-alerts.service';
import { ServerFanService } from './server-fan.service';

/**
 * The server agent's reports, and the server page's view of them. The agent authenticates with its own token, not a user session.
 */
@Controller('api/server')
export class ServerAgentController {
  constructor(
    private readonly agent: ServerAgentService,
    private readonly fan: ServerFanService,
    private readonly alerts: ServerAlertsService,
  ) {}

  /**
   * A new agent token, shown once; the old one stops working. Owner only.
   */
  @Post('agent/token')
  @UseGuards(AuthGuard('jwt'))
  newToken(@CurrentUser() user: AuthenticatedUser) {
    return this.agent.newToken(user.userId);
  }

  /**
   * The latest sample and whether the agent is reporting. Owner and viewers.
   */
  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.agent.status(user.userId);
  }

  /** CPU, memory, temperature, fan and network over 24h or 7d, in buckets. Owner and viewers. */
  @Get('history')
  @UseGuards(AuthGuard('jwt'))
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('range') range?: string,
    @Query('to') to?: string,
  ) {
    return this.agent.history(
      user.userId,
      range,
      to ? new Date(to) : undefined,
    );
  }

  /** One sample from the agent; answered with the fan settings. */
  @Post('agent/samples')
  @HttpCode(202)
  async postSample(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    if (!token || !(await this.agent.isAgent(token))) {
      throw new UnauthorizedException('Unknown server agent token');
    }
    const sample = parseHostSample(body);
    const stored = await this.agent.ingest(sample);
    if (stored.stored) await this.alerts.onSample(sample);
    // The fan settings ride on the answer: the agent applies them each cycle.
    return { ...stored, fan: await this.fan.settings() };
  }
}
