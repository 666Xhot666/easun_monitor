import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Needed for the refresh-token flow: AuthController reads the refresh
  // token off req.cookies rather than a header, since it's set httpOnly
  // and never touches frontend JS.
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      // Strips any body field not declared on the DTO rather than silently
      // accepting it — matters here since request bodies (register/login,
      // inverter setup) end up written straight into columns like
      // passwordHash's *input*, so an unexpected extra field should be
      // rejected, not ignored.
      whitelist: true,
      forbidNonWhitelisted: true,
      // Query/body values arrive as strings over HTTP; DTOs declare real
      // types (numbers for ratedPowerWatts, etc.), so this coerces them
      // to match instead of every @IsNumber() failing on a numeric string.
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
