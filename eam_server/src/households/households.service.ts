import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** read: any member. write: admins only. */
export type Access = 'read' | 'write';

/** Who belongs to which household, and in what role. */
@Injectable()
export class HouseholdsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The household the user administers (one per admin), or null. */
  async adminHouseholdId(userId: number): Promise<number | null> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, role: 'ADMIN' },
      select: { householdId: true },
    });
    return membership?.householdId ?? null;
  }

  /** Every household the user belongs to, in any role. */
  async householdIds(userId: number): Promise<number[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { householdId: true },
    });
    return memberships.map((m) => m.householdId);
  }

  /**
   * The inverter profile, if the user may access it: 404 when they are not a
   * member of its household (the same as for a missing id, so nobody learns
   * that an id exists), 403 when a reader asks to write.
   */
  async requireProfile(profileId: number, userId: number, access: Access) {
    const profile = await this.prisma.inverterProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile?.householdId)
      throw new NotFoundException('No such inverter profile');
    await this.requireHousehold(
      profile.householdId,
      userId,
      access,
      'No such inverter profile',
    );
    return profile;
  }

  /** A panel type, with the same rules as `requireProfile`. */
  async requirePanelType(panelTypeId: number, userId: number, access: Access) {
    const panelType = await this.prisma.panelType.findUnique({
      where: { id: panelTypeId },
    });
    if (!panelType?.householdId)
      throw new NotFoundException('Panel type not found');
    await this.requireHousehold(
      panelType.householdId,
      userId,
      access,
      'Panel type not found',
    );
    return panelType;
  }

  private async requireHousehold(
    householdId: number,
    userId: number,
    access: Access,
    notFound: string,
  ): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_householdId: { userId, householdId } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException(notFound);
    if (access === 'write' && membership.role !== 'ADMIN') {
      throw new ForbiddenException('Read-only access to this household');
    }
  }
}
