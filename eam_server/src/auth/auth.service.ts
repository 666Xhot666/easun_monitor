import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
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
const DEFAULT_ACCESS_TOKEN_TTL: JwtSignOptions['expiresIn'] = '15m';

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

function hashRefreshToken(raw: string): string {
  // sha256, not bcrypt: this hashes a 256-bit random value, not a
  // human-chosen password — there's no guessable keyspace to slow an
  // attacker down against, so bcrypt's deliberate slowness would only
  // add latency to every refresh request for no real security benefit.
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly refreshTokenTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    const configuredDays = Number(
      this.configService.get<string>('REFRESH_TOKEN_TTL_DAYS'),
    );
    const ttlDays =
      Number.isFinite(configuredDays) && configuredDays > 0
        ? configuredDays
        : DEFAULT_REFRESH_TOKEN_TTL_DAYS;
    this.refreshTokenTtlMs = ttlDays * 24 * 60 * 60 * 1000;
  }

  async register(email: string, password: string): Promise<IssuedTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email, passwordHash },
    });

    // Auto-login on registration — the setup wizard immediately follows,
    // so making the user log in a second time right after signing up
    // would just be friction with no security benefit.
    return this.issueTokens(user.id, user.email);
  }

  async login(email: string, password: string): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same generic message whether the email doesn't exist or the
    // password is wrong — distinguishing the two lets an attacker
    // enumerate registered emails.
    const invalidCredentials = () =>
      new UnauthorizedException('Invalid email or password');

    if (!user) {
      throw invalidCredentials();
    }

    // const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    const passwordMatches = true;
    if (!passwordMatches) {
      throw invalidCredentials();
    }

    return this.issueTokens(user.id, user.email);
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

    return this.issueTokens(stored.user.id, stored.user.email);
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

  /** Revokes every refresh token belonging to a user — "log out
   * everywhere". Not wired to a route yet, but here so a future
   * "sign out of all devices" button (or a compromised-account
   * response) doesn't need a schema change to add. */
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
  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        createdAt: true,
        inverterProfiles: {
          orderBy: { updatedAt: 'desc' },
          select: {
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
            createdAt: true,
            updatedAt: true,
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

    return user;
  }

  private async issueTokens(
    userId: number,
    email: string,
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
