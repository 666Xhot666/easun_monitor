import { InvitesService } from '../households/invites.service';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

// Cost factor for bcrypt hashing — 12 is comfortably above the commonly
// recommended floor (10) without making login noticeably slow on modest
// hardware (this runs on a small home server/NAS, not scaled infra).
const BCRYPT_SALT_ROUNDS = 12;

// Refresh tokens are opaque random values, not JWTs — there's nothing to
// decode or verify offline, so the only way to use one is to look its
// hash up in the database. That's what makes rotation and revocation
// possible at all; a self-verifying JWT refresh token could never be
// un-issued early (logout, a stolen-token report, etc).
const REFRESH_TOKEN_BYTES = 32;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;
/** Access-token lifetime when JWT_EXPIRES_IN is unset; the one default. */
export const DEFAULT_ACCESS_TOKEN_TTL: JwtSignOptions['expiresIn'] = '15m';

export interface AuthResult {
  accessToken: string;
  user: {
    id: number;
    email: string;
  };
}

/** Internal shape used between AuthService and AuthController only — the
 * raw refresh token never appears in a JSON response body; the
 * controller peels it off to set an httpOnly cookie and returns the
 * plain AuthResult to the client. */
export interface IssuedTokens extends AuthResult {
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/** One browser's sign-in, kept across refresh-token rotations. */
interface Session {
  sessionId: string;
  userAgent: string | null;
}

/** A new session for a sign-in; the User-Agent is cut to a sane length. */
function newSession(userAgent?: string): Session {
  return {
    sessionId: randomUUID(),
    userAgent: userAgent?.slice(0, 300) ?? null,
  };
}

function hashRefreshToken(raw: string): string {
  // sha256, not bcrypt: this hashes a 256-bit random value, not a
  // human-chosen password — there's no guessable keyspace to slow an
  // attacker down against, so bcrypt's deliberate slowness would only
  // add latency to every refresh request for no real security benefit.
  return createHash('sha256').update(raw).digest('hex');
}

/** The inverter profile fields /me returns. */
const PROFILE_FIELDS = {
  id: true,
  name: true,
  ipAddress: true,
  port: true,
  ratedPowerWatts: true,
  batteryNominalVoltage: true,
  batteryCapacityAh: true,
  batteryType: true,
  lowBatteryCutoffVoltage: true,
  bulkChargeVoltage: true,
  floatChargeVoltage: true,
  pvPanelTypeId: true,
  pvPanelsInSeries: true,
  pvStrings: true,
  pvMaxVocV: true,
  pvMpptMinV: true,
  pvMpptMaxV: true,
  pvMaxPowerW: true,
  pvMaxCurrentA: true,
  householdId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** A new user's own household, with the user as its admin. */
const OWN_HOUSEHOLD = {
  create: { role: 'ADMIN' as const, household: { create: { name: 'Home' } } },
};

@Injectable()
export class AuthService {
  private readonly refreshTokenTtlMs: number;
  private readonly registrationOpen: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly invites: InvitesService,
  ) {
    const configuredDays = Number(
      this.configService.get<string>('REFRESH_TOKEN_TTL_DAYS'),
    );
    const ttlDays =
      Number.isFinite(configuredDays) && configuredDays > 0
        ? configuredDays
        : DEFAULT_REFRESH_TOKEN_TTL_DAYS;
    this.refreshTokenTtlMs = ttlDays * 24 * 60 * 60 * 1000;
    this.registrationOpen =
      this.configService.get<string>('ALLOW_REGISTRATION') === 'true';
  }

  async register(
    email: string,
    password: string,
    inviteCode?: string,
    userAgent?: string,
  ): Promise<IssuedTokens> {
    // The first account can always be created (that's how an install is
    // set up); after that, sign-up is closed unless the operator opens it,
    // so a dashboard reachable on the LAN can't collect strangers' accounts.
    // An invite code is the controlled way in, so it works even when closed.
    if (
      !inviteCode &&
      !this.registrationOpen &&
      (await this.prisma.user.count()) > 0
    ) {
      throw new ForbiddenException(
        'Registration is closed. The owner can allow new accounts with ALLOW_REGISTRATION=true.',
      );
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    // With an invite, the user joins that household and gets none of their
    // own; a bad code creates nothing.
    const user = inviteCode
      ? await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: { email, passwordHash },
          });
          await this.invites.redeemIn(tx, inviteCode, created.id);
          return created;
        })
      : await this.prisma.user.create({
          data: { email, passwordHash, memberships: OWN_HOUSEHOLD },
        });

    // Auto-login on registration — the setup wizard immediately follows,
    // so making the user log in a second time right after signing up
    // would just be friction with no security benefit.
    return this.issueTokens(user.id, user.email, newSession(userAgent));
  }

  async login(
    email: string,
    password: string,
    userAgent?: string,
  ): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same generic message whether the email doesn't exist or the
    // password is wrong — distinguishing the two lets an attacker
    // enumerate registered emails.
    const invalidCredentials = () =>
      new UnauthorizedException('Invalid email or password');

    if (!user) {
      throw invalidCredentials();
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw invalidCredentials();
    }

    return this.issueTokens(user.id, user.email, newSession(userAgent));
  }

  /**
   * Issues tokens for `email` without a password, for dev-mode auto-login
   * only; the caller is responsible for the dev-mode gate. On a fresh
   * install the account is created first, with a random password nobody
   * knows, so there is no registration step.
   */
  async devLogin(email: string, userAgent?: string): Promise<IssuedTokens> {
    const user =
      (await this.prisma.user.findUnique({ where: { email } })) ??
      (await this.prisma.user.create({
        data: {
          email,
          passwordHash: await bcrypt.hash(
            randomBytes(32).toString('hex'),
            BCRYPT_SALT_ROUNDS,
          ),
          memberships: OWN_HOUSEHOLD,
        },
      }));
    return this.issueTokens(user.id, user.email, newSession(userAgent));
  }

  /**
   * Exchanges a still-valid refresh token for a fresh access token, and
   * rotates the refresh token in the same operation: the presented one
   * is revoked, and a brand new one is issued and stored. A stolen
   * refresh token that's already been used once by its rightful owner
   * becomes worthless to whoever stole it — replaying a revoked token
   * fails just like an expired one.
   */
  async refresh(rawRefreshToken: string): Promise<IssuedTokens> {
    const invalid = () =>
      new UnauthorizedException('Invalid or expired refresh token');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawRefreshToken) },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw invalid();
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    // The new token continues the same browser's session.
    return this.issueTokens(stored.user.id, stored.user.email, {
      sessionId: stored.sessionId,
      userAgent: stored.userAgent,
    });
  }

  /** Revokes a single refresh token. Idempotent — a token that's already
   * gone or already revoked isn't an error, since the end state ("not
   * usable") is identical either way; logout shouldn't fail just
   * because the session was already dead. */
  async logout(rawRefreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every refresh token belonging to a user: "sign out
   * everywhere". Access tokens already issued stay valid until they
   * expire (at most JWT_EXPIRES_IN). */
  async logoutAll(userId: number): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Full profile bundle for `GET /api/auth/me`: the account plus every
   * inverter it has paired, so the frontend route guard can decide
   * unauthenticated / needs-setup / dashboard-ready in one round trip.
   */
  /**
   * The user, their households with their role in each, and the inverters
   * of all those households, each tagged with that role.
   */
  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        createdAt: true,
        memberships: {
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            household: {
              select: {
                id: true,
                name: true,
                inverterProfiles: {
                  orderBy: { updatedAt: 'desc' },
                  select: PROFILE_FIELDS,
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      // A valid, unexpired token for a user that no longer exists (e.g.
      // manually deleted from the DB) — treat it the same as "not logged
      // in" rather than a 404, since from the client's perspective the
      // session is simply invalid.
      throw new UnauthorizedException('Account no longer exists');
    }

    const { memberships, ...rest } = user;
    return {
      ...rest,
      adminHouseholdId:
        memberships.find((m) => m.role === 'ADMIN')?.household.id ?? null,
      households: memberships.map((m) => ({
        id: m.household.id,
        name: m.household.name,
        role: m.role,
      })),
      inverterProfiles: memberships.flatMap((m) =>
        m.household.inverterProfiles.map((p) => ({ ...p, role: m.role })),
      ),
    };
  }

  /**
   * The user's signed-in browsers: one per session with a usable refresh
   * token, most recently used first. `rawRefreshToken` (this browser's
   * cookie) marks the current one.
   */
  async sessions(userId: number, rawRefreshToken?: string) {
    const now = new Date();
    const active = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastUsedAt: 'desc' },
    });
    const started = await this.prisma.refreshToken.groupBy({
      by: ['sessionId'],
      where: { userId, sessionId: { in: active.map((t) => t.sessionId) } },
      _min: { createdAt: true },
    });
    const startedAt = new Map(
      started.map((g) => [g.sessionId, g._min.createdAt]),
    );
    const currentHash = rawRefreshToken
      ? hashRefreshToken(rawRefreshToken)
      : null;
    return active.map((t) => ({
      id: t.sessionId,
      userAgent: t.userAgent,
      signedInAt: startedAt.get(t.sessionId) ?? t.createdAt,
      lastUsedAt: t.lastUsedAt,
      current: t.tokenHash === currentHash,
    }));
  }

  /** Signs one of the user's browsers out. */
  async revokeSession(userId: number, sessionId: string): Promise<void> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('No such session');
  }

  /**
   * Changes the password after checking the current one, and signs out
   * every other browser; the one making the change stays signed in.
   */
  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    rawRefreshToken?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('The current password is wrong');
    }
    const current = rawRefreshToken
      ? await this.prisma.refreshToken.findUnique({
          where: { tokenHash: hashRefreshToken(rawRefreshToken) },
          select: { sessionId: true },
        })
      : null;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS),
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(current ? { sessionId: { not: current.sessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async issueTokens(
    userId: number,
    email: string,
    session: Session,
  ): Promise<IssuedTokens> {
    const payload: JwtPayload = { sub: userId, email };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      // `expiresIn` is typed by @nestjs/jwt as `number | StringValue`
      // (ms's template-literal union, e.g. "60s" | "15m"), not a plain
      // `string` — ConfigService.get<string>() can't satisfy that
      // statically, so we assert the shape here at the one place the
      // env value enters typed code.
      expiresIn: (this.configService.get<string>('JWT_EXPIRES_IN') ??
        DEFAULT_ACCESS_TOKEN_TTL) as JwtSignOptions['expiresIn'],
    });

    const rawRefreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const refreshTokenExpiresAt = new Date(Date.now() + this.refreshTokenTtlMs);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(rawRefreshToken),
        userId,
        expiresAt: refreshTokenExpiresAt,
        sessionId: session.sessionId,
        userAgent: session.userAgent,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresAt,
      user: { id: userId, email },
    };
  }
}
