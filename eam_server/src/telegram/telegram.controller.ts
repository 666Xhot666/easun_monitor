import { Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { TelegramLinksService } from './telegram-links.service';

/** Linking the signed-in user's Telegram chat to the bot. */
@Controller('api/telegram')
@UseGuards(AuthGuard('jwt'))
export class TelegramController {
  constructor(private readonly links: TelegramLinksService) {}

  /** A one-time code to send to the bot as /start <code>; valid 10 minutes. */
  @Post('link-code')
  linkCode(@CurrentUser() user: AuthenticatedUser) {
    return this.links.createCode(user.userId);
  }

  @Get('link')
  async status(@CurrentUser() user: AuthenticatedUser) {
    return { linked: await this.links.isLinked(user.userId) };
  }

  @Delete('link')
  async unlink(@CurrentUser() user: AuthenticatedUser) {
    await this.links.unlinkUser(user.userId);
    return { success: true as const };
  }
}
