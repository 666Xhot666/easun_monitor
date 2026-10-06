import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}
