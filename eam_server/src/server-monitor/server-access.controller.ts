import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PutServerUserDto } from './dto/put-server-user.dto';
import { ServerAccessService } from './server-access.service';

/** Who may look at the server page: the owner chooses among all accounts. */
@Controller('api/server')
@UseGuards(AuthGuard('jwt'))
export class ServerAccessController {
  constructor(private readonly access: ServerAccessService) {}

  @Get('users')
  users(@CurrentUser() user: AuthenticatedUser) {
    return this.access.users(user.userId);
  }

  @Put('users/:userId')
  setViewer(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PutServerUserDto,
  ) {
    return this.access.setViewer(user.userId, userId, dto.viewer);
  }
}
