import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  AuthService,
  type AuthResult,
  type IssuedTokens,
} from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './interfaces/jwt-payload.interface';

const REFRESH_TOKEN_COOKIE = 'refresh_token';
// Scoped to /api/auth so the browser only ever attaches this cookie to
// the handful of routes that actually read it, instead of sending it
// alongside every other API request.
const REFRESH_TOKEN_COOKIE_PATH = '/api/auth';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const tokens = await this.authService.register(
      dto.email,
      dto.password,
      dto.inviteCode,
    );
    return this.respondWithTokens(tokens, res);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const tokens = await this.authService.login(dto.email, dto.password);
    return this.respondWithTokens(tokens, res);
  }

  /**
   * Dev-mode auto-login: signs in as DEV_AUTO_LOGIN_EMAIL without a
   * password, creating that account on a fresh install. Exists only when NODE_ENV is not production AND
   * DEV_AUTO_LOGIN=true; two independent checks, so a production
   * deployment with the flag set by mistake still gets a 404.
   */
  @Get('dev-login')
  async devLogin(
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const notFound = () => new NotFoundException();
    if (this.configService.get<string>('NODE_ENV') === 'production')
      throw notFound();
    if (this.configService.get<string>('DEV_AUTO_LOGIN') !== 'true')
      throw notFound();
    const email = this.configService.get<string>('DEV_AUTO_LOGIN_EMAIL');
    if (!email) throw notFound();
    return this.respondWithTokens(await this.authService.devLogin(email), res);
  }

  // No @UseGuards here deliberately — this runs precisely when the access
  // token has expired (that's the whole point of it existing), so it
  // authenticates off the refresh cookie itself rather than a Bearer
  // token that may already be stale.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const rawRefreshToken = this.readRefreshCookie(req);
    if (!rawRefreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }
    const tokens = await this.authService.refresh(rawRefreshToken);
    return this.respondWithTokens(tokens, res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const rawRefreshToken = this.readRefreshCookie(req);
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_TOKEN_COOKIE_PATH });
  }

  /** Revokes every session of the calling user, including this one. */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard('jwt'))
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logoutAll(user.userId);
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_TOKEN_COOKIE_PATH });
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user.userId);
  }

  private readRefreshCookie(req: Request): string | undefined {
    const cookies = req.cookies as
      Record<string, string | undefined> | undefined;
    return cookies?.[REFRESH_TOKEN_COOKIE];
  }

  /** Sets the rotated refresh token as an httpOnly cookie and returns
   * only the access token + user to the client — the raw refresh token
   * never appears in a JSON response body or touches frontend JS. */
  private respondWithTokens(tokens: IssuedTokens, res: Response): AuthResult {
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      // Only require HTTPS for the cookie in production — the dev/docker
      // setup here is plain HTTP, and `secure: true` would make the
      // browser silently refuse to store the cookie at all over http.
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      path: REFRESH_TOKEN_COOKIE_PATH,
      expires: tokens.refreshTokenExpiresAt,
    });
    return { accessToken: tokens.accessToken, user: tokens.user };
  }
}
