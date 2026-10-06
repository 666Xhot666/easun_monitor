import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PollingService } from '../src/inverter/polling.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Boots the full app against the test database, with the background
 * poller replaced so no test ever opens a socket to a logger. */
export async function createTestApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<INestApplication<App>> {
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PollingService)
      .useValue({ syncProfiles: async () => {} }),
  ).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await listenOnLoopback(app);
  return app;
}

/**
 * Starts the app on a free 127.0.0.1 port, which supertest then uses.
 * Left to supertest, it listens on all interfaces but connects to
 * 127.0.0.1, so a port some other local app holds on loopback sends
 * the request to that app (random 401/403/404s).
 */
export async function listenOnLoopback(app: INestApplication): Promise<void> {
  await app.listen(0, '127.0.0.1');
}

export async function resetDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe(
    'TRUNCATE telegram_link_codes, telegram_links, household_invites, household_memberships, households, bms_log_hourly, bms_logs, bms_devices, panel_types, inverter_settings_snapshots, inverter_logs, inverter_profiles, refresh_tokens, users RESTART IDENTITY CASCADE',
  );
}

export async function registerUser(
  app: INestApplication<App>,
  email: string,
  password = 'correct-horse-battery',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password })
    .expect(201);
  return res.body.accessToken as string;
}

export const sampleProfile = {
  name: 'Garage inverter',
  ipAddress: '192.168.1.50',
  port: 8899,
  ratedPowerWatts: 3200,
  batteryNominalVoltage: 24,
  batteryCapacityAh: 200,
  batteryType: 'LIFEPO4',
};
