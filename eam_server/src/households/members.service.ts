import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HouseholdRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { HouseholdsService } from './households.service';

const MEMBER_FIELDS = {
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { email: true } },
} as const;

type MemberRow = {
  userId: number;
  role: HouseholdRole;
  createdAt: Date;
  user: { email: string };
};
const toMember = ({ user, ...rest }: MemberRow) => ({
  ...rest,
  email: user.email,
});

/** A household's members: listed by any member, managed by admins. */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
  ) {}

  async list(householdId: number, userId: number) {
    await this.households.requireMember(householdId, userId, 'read');
    const rows = await this.prisma.membership.findMany({
      where: { householdId },
      orderBy: { createdAt: 'asc' },
      select: MEMBER_FIELDS,
    });
    return rows.map(toMember);
  }

  /** Never leaves the household without an admin; one household per admin. */
  async changeRole(
    householdId: number,
    targetUserId: number,
    role: HouseholdRole,
    userId: number,
  ) {
    await this.households.requireMember(householdId, userId, 'write');
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.membership.findUnique({
        where: { userId_householdId: { userId: targetUserId, householdId } },
      });
      if (!target) throw new NotFoundException('Member not found');
      if (target.role === 'ADMIN' && role === 'READER') {
        const admins = await tx.membership.count({
          where: { householdId, role: 'ADMIN' },
        });
        if (admins === 1)
          throw new ConflictException('A household needs at least one admin');
      }
      if (target.role !== 'ADMIN' && role === 'ADMIN') {
        const adminElsewhere = await tx.membership.count({
          where: {
            userId: targetUserId,
            role: 'ADMIN',
            householdId: { not: householdId },
          },
        });
        if (adminElsewhere) {
          throw new ConflictException(
            'This member already runs another household and cannot be an admin here',
          );
        }
      }
      const updated = await tx.membership.update({
        where: { id: target.id },
        data: { role },
        select: MEMBER_FIELDS,
      });
      return toMember(updated);
    });
  }

  /** Admins remove anyone; any member may leave. Never the last admin. */
  async remove(householdId: number, targetUserId: number, userId: number) {
    await this.households.requireMember(
      householdId,
      userId,
      targetUserId === userId ? 'read' : 'write',
    );
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.membership.findUnique({
        where: { userId_householdId: { userId: targetUserId, householdId } },
      });
      if (!target) throw new NotFoundException('Member not found');
      if (target.role === 'ADMIN') {
        const admins = await tx.membership.count({
          where: { householdId, role: 'ADMIN' },
        });
        if (admins === 1)
          throw new ConflictException('A household needs at least one admin');
      }
      await tx.membership.delete({ where: { id: target.id } });
    });
  }
}
