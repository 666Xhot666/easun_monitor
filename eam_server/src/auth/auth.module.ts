import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

// @Global (matching PrismaModule's own pattern) so ConfigService-backed
// JwtStrategy is guaranteed to be constructed at bootstrap — which is
// what actually registers the 'jwt' strategy with passport's own global
// registry — without every feature module needing to import AuthModule
// just to use @UseGuards(AuthGuard('jwt')) from '@nestjs/passport'.
//
// Controllers use AuthGuard('jwt') directly rather than a JwtAuthGuard
// subclass: a bare `class JwtAuthGuard extends AuthGuard('jwt') {}` has
// no constructor of its own, and Nest reflects @Optional() constructor
// params with Reflect.getOwnMetadata (no prototype-chain walk) — so a
// subclass silently loses the @Optional() marker @nestjs/passport puts
// on its AuthModuleOptions param and Nest starts treating it as
// required, breaking guard resolution in any module other than this
// one. Using AuthGuard('jwt') itself sidesteps that entirely.
@Global()
@Module({
  imports: [
    PassportModule,
    // registerAsync (not a static secret) so JwtService picks up
    // JWT_SECRET from ConfigService the same way JwtStrategy does —
    // one source of truth for the signing key instead of two places
    // that could drift.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          // `expiresIn` is typed by @nestjs/jwt as `number | StringValue`
          // (ms's template-literal union, e.g. "60s" | "7d"), not a plain
          // `string` — ConfigService.get<string>() can't satisfy that
          // statically, so we assert the shape here at the one place the
          // env value enters typed code.
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ?? '7d') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
