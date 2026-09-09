import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Pulls the authenticated user (attached to `request.user` by
 * AuthGuard('jwt')/JwtStrategy) into a handler parameter, e.g.:
 *
 *   getMe(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * Only meaningful behind `@UseGuards(AuthGuard('jwt'))` — on an
 * unguarded route `request.user` is undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
