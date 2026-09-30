import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/**
 * Middleware and global pipes shared by main.ts and the e2e tests, so the
 * tests exercise the same request handling as production.
 */
export function configureApp(app: INestApplication): void {
  app.use(helmet());

  // Needed for the refresh-token flow: AuthController reads the refresh
  // token off req.cookies rather than a header, since it's set httpOnly
  // and never touches frontend JS.
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      // Rejects any body field not declared on the DTO instead of silently
      // accepting it, since request bodies end up written into columns.
      whitelist: true,
      forbidNonWhitelisted: true,
      // Query/body values arrive as strings over HTTP; DTOs declare real
      // types (numbers for ratedPowerWatts, etc.), so this coerces them.
      transform: true,
    }),
  );
}
