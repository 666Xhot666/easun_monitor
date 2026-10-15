import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { localized } from '../i18n/localized';

/** What a user may do on the server page: the owner everything, a viewer look. */
export type ServerRole = 'OWNER' | 'VIEWER';

/**
 * The server's owner (one, apart from households: the installation's first
 * account) and the accounts the owner lets look at the server page.
 */
@Injectable()
export class ServerAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async role(userId: number): Promise<ServerRole | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { serverViewer: true, serverOwner: { select: { id: true } } },
    });
    if (user?.serverOwner) return 'OWNER';
    return user?.serverViewer ? 'VIEWER' : null;
  }

  /** For the owner's eyes and actions only. */
  async requireOwner(userId: number): Promise<void> {
    if ((await this.role(userId)) !== 'OWNER') {
      throw new ForbiddenException(localized('ownerOnly'));
    }
  }

  /** For the owner and the viewers. */
  async requireViewer(userId: number): Promise<ServerRole> {
    const role = await this.role(userId);
    if (!role) throw new ForbiddenException(localized('noServerAccess'));
    return role;
  }

  /**
   * Makes `userId` the owner when there is none yet: the first account of a
   * new installation. Within the transaction that creates the account.
   */
  async claimIfUnowned(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<void> {
    await tx.serverOwner.createMany({
      data: [{ id: 1, userId }],
      skipDuplicates: true,
    });
  }

  /** Every account, with whether it owns or may look at the server. */
  async users(ownerId: number) {
    await this.requireOwner(ownerId);
    const users = await this.prisma.user.findMany({
      orderBy: { email: 'asc' },
      select: {
        id: true,
        email: true,
        serverViewer: true,
        serverOwner: { select: { id: true } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      owner: u.serverOwner !== null,
      viewer: u.serverViewer,
    }));
  }

  async setViewer(ownerId: number, userId: number, viewer: boolean) {
    await this.requireOwner(ownerId);
    if (userId === ownerId) {
      throw new BadRequestException(localized('ownerAlwaysAccess'));
    }
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { serverViewer: viewer },
    });
    if (count === 0) throw new NotFoundException('No such account');
    return { id: userId, viewer };
  }
}
