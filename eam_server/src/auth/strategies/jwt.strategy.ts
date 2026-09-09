import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser, JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error(
        'JWT_SECRET is not set. Configure it in your .env file before starting the server ' +
          '(e.g. `openssl rand -base64 48`) — there is no default, since a hardcoded ' +
          'fallback would let anyone who has read this code forge valid tokens.',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Runs once passport-jwt has already verified the token's signature and
   * expiry. We only need to reshape the payload here — no DB lookup — so a
   * request that presents a still-valid token for a since-deleted user
   * isn't silently treated as authenticated by an unrelated stale cache;
   * any handler that needs the live user row fetches it itself.
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload?.sub || !payload?.email) {
      throw new UnauthorizedException('Malformed token payload');
    }
    return { userId: payload.sub, email: payload.email };
  }
}
