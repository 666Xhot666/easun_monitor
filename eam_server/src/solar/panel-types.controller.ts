import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { PanelTypeDto } from './dto/panel-type.dto';

/** The user's list of solar panel types, shared by all their inverters. */
@Controller('api/panel-types')
@UseGuards(AuthGuard('jwt'))
export class PanelTypesController {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.rejectDuplicateName(() =>
      this.prisma.panelType.create({ data: { ...dto, userId: user.userId } }),
    );
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
