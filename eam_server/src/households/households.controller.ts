import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { HouseholdRoleDto } from './dto/household-role.dto';
import { JoinHouseholdDto } from './dto/join-household.dto';
import { InvitesService } from './invites.service';
import { MembersService } from './members.service';

/** Household members, invites and joining. */
@Controller('api/households')
@UseGuards(AuthGuard('jwt'))
export class HouseholdsController {
  constructor(
    private readonly invites: InvitesService,
    private readonly members: MembersService,
  ) {}

  /** Joins a household with an invite code. Rate-limited against guessing. */
  @Post('join')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  join(@Body() dto: JoinHouseholdDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invites.redeem(dto.code, user.userId);
  }

  @Get(':id/invites')
  listInvites(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invites.listOpen(id, user.userId);
  }

  /** Creates an invite; its code is in this response only. */
  @Post(':id/invites')
  createInvite(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HouseholdRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invites.create(id, user.userId, dto.role);
  }

  @Delete(':id/invites/:inviteId')
  async revokeInvite(
    @Param('id', ParseIntPipe) id: number,
    @Param('inviteId', ParseIntPipe) inviteId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.invites.revoke(id, inviteId, user.userId);
    return { success: true as const };
  }

  @Get(':id/members')
  listMembers(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.members.list(id, user.userId);
  }

  @Patch(':id/members/:userId')
  changeRole(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) memberId: number,
    @Body() dto: HouseholdRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.members.changeRole(id, memberId, dto.role, user.userId);
  }

  /** Removes a member, or leaves when it is the caller. */
  @Delete(':id/members/:userId')
  async removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) memberId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.members.remove(id, memberId, user.userId);
    return { success: true as const };
  }
}
