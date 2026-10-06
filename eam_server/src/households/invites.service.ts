import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { HouseholdRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { HouseholdsService } from './households.service';

/** No 0/O, 1/I/L: easy to read out and type. 32 letters, 8 of them: 40 bits. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const VALID_FOR_MS = 7 * 24 * 60 * 60 * 1000;

const OPEN_INVITE_FIELDS = {
  id: true,
  role: true,
  expiresAt: true,
  createdAt: true,
} as const;

/** "k7q2 9xpa" or "K7Q2-9XPA" -> "K7Q29XPA". */
const normalize = (code: string) =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (code: string) =>
  createHash('sha256').update(normalize(code)).digest('hex');

type Tx = Prisma.TransactionClient;

/**
 * Household invites: an admin creates one with a role; it is a single-use
 * code that expires after 7 days, stored only as a hash.
 */
@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
  ) {}

  /** Creates an invite; the code is returned here only. */
  async create(householdId: number, userId: number, role: HouseholdRole) {
    await this.households.requireMember(householdId, userId, 'write');
    const raw = Array.from(
      { length: CODE_LENGTH },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join('');
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    const invite = await this.prisma.householdInvite.create({
      data: {
        householdId,
        role,
        codeHash: hashCode(code),
        createdById: userId,
        expiresAt: new Date(Date.now() + VALID_FOR_MS),
      },
      select: OPEN_INVITE_FIELDS,
    });
    return { invite, code };
  }

  /** Invites not yet used and not expired. */
  async listOpen(householdId: number, userId: number) {
    await this.households.requireMember(householdId, userId, 'write');
    return this.prisma.householdInvite.findMany({
      where: { householdId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: OPEN_INVITE_FIELDS,
    });
  }

  async revoke(householdId: number, inviteId: number, userId: number) {
    await this.households.requireMember(householdId, userId, 'write');
    await this.prisma.householdInvite.deleteMany({
      where: { id: inviteId, householdId },
    });
  }

  /** Redeems a code for an existing user. */
  redeem(code: string, userId: number) {
    return this.prisma.$transaction((tx) => this.redeemIn(tx, code, userId));
  }

  /**
   * Adds the user to the invite's household, inside a transaction. A user
   * whose own household has no inverters gives it up; one whose household
   * has inverters may join others only as a reader (one household per admin).
   */
  async redeemIn(tx: Tx, code: string, userId: number) {
    const invite = await tx.householdInvite.findUnique({
      where: { codeHash: hashCode(code) },
    });
    if (!invite || invite.usedAt || invite.expiresAt <= new Date()) {
      throw new BadRequestException('This invite code is not valid');
    }
    const memberships = await tx.membership.findMany({
      where: { userId },
      include: {
        household: {
          select: { _count: { select: { inverterProfiles: true } } },
        },
      },
    });
    if (memberships.some((m) => m.householdId === invite.householdId)) {
      throw new ConflictException('You are already a member of this household');
    }
    const own = memberships.find((m) => m.role === 'ADMIN');
    if (own && own.household._count.inverterProfiles === 0) {
      await tx.household.delete({ where: { id: own.householdId } });
    } else if (own && invite.role === 'ADMIN') {
      throw new ConflictException(
        'You already run a household with inverters; you can join others only as a reader',
      );
    }

    // Conditional update: two people racing for one code cannot both use it.
    const claimed = await tx.householdInvite.updateMany({
      where: { id: invite.id, usedAt: null },
      data: { usedAt: new Date(), usedById: userId },
    });
    if (claimed.count !== 1)
      throw new BadRequestException('This invite code is not valid');

    await tx.membership.create({
      data: { userId, householdId: invite.householdId, role: invite.role },
    });
    return { householdId: invite.householdId, role: invite.role };
  }
}
