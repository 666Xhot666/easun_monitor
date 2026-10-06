import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { PanelTypeDto } from './dto/panel-type.dto';
import { HouseholdsService } from '../households/households.service';

/** The user's list of solar panel types, shared by all their inverters. */
@Controller('api/panel-types')
@UseGuards(AuthGuard('jwt'))
export class PanelTypesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.panelType.findMany({
      where: { userId: user.userId },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  async create(
    @Body() dto: PanelTypeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    checkDatasheet(dto);
    const householdId = await this.households.adminHouseholdId(user.userId);
    return this.rejectDuplicateName(() =>
      this.prisma.panelType.create({
        data: {
          ...dto,
          userId: user.userId,
          householdId,
        },
      }),
    );
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PanelTypeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwned(id, user.userId);
    checkDatasheet(dto);
    return this.rejectDuplicateName(() =>
      this.prisma.panelType.update({ where: { id }, data: dto }),
    );
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwned(id, user.userId);
    const users = await this.prisma.inverterProfile.count({
      where: { pvPanelTypeId: id },
    });
    if (users > 0) {
      throw new ConflictException(
        'An inverter uses this panel type; choose another type for it first',
      );
    }
    await this.prisma.panelType.delete({ where: { id } });
    return { success: true as const };
  }

  /** 404s for another user's panel type, the same as for a missing one. */
  private async requireOwned(id: number, userId: number) {
    const panelType = await this.prisma.panelType.findFirst({
      where: { id, userId },
    });
    if (!panelType) {
      throw new NotFoundException('Panel type not found');
    }
    return panelType;
  }

  private async rejectDuplicateName<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          'You already have a panel type with this name',
        );
      }
      throw error;
    }
  }
}

/** The maximum power point lies inside the open-circuit and short-circuit limits. */
function checkDatasheet(panel: PanelTypeDto): void {
  if (panel.vmpV > panel.vocV) {
    throw new BadRequestException('Vmp must not exceed Voc');
  }
  if (panel.impA > panel.iscA) {
    throw new BadRequestException('Imp must not exceed Isc');
  }
}
