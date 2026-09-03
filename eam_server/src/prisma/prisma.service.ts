import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Thin wrapper around PrismaClient that hooks its connection lifecycle into
 * Nest's own — connects when the module starts, disconnects cleanly on
 * shutdown. Prisma 7 requires a driver adapter instead of an embedded
 * connection string, so the adapter is built from ConfigService (not
 * process.env directly) to keep this consistent with the rest of the app
 * and fail with a clear error, not a cryptic connection failure, if
 * DATABASE_URL is ever missing.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. docker-compose.yml composes it automatically ' +
          'from POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB in your .env file.',
      );
    }

    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL via Prisma');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Disconnected from PostgreSQL');
  }
}
