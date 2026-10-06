import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

const longi = {
  name: 'Longi 450W',
  maxPowerW: 450,
  vmpV: 41.5,
  impA: 10.85,
  vocV: 49.5,
  iscA: 11.5,
};

describe('Households (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;

  // Users are made once: registration is rate-limited.
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
  });

  afterAll(() => app.close());

  const call = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);
  const owner = () =>
    prisma.user.findUniqueOrThrow({
      where: { email: 'owner@example.com' },
      include: { memberships: true },
    });

  it('gives a newly registered user their own household, as its admin', async () => {
    const user = await owner();
    expect(user.memberships).toEqual([
      expect.objectContaining({
        role: 'ADMIN',
        householdId: expect.any(Number),
      }),
    ]);
  });

  it("puts a paired inverter and a panel type in the user's household", async () => {
    const { memberships } = await owner();
    const householdId = memberships[0].householdId;

    const profile = (
      await call('post', '/api/inverter/setup').send(sampleProfile).expect(201)
    ).body;
    const panelType = (
      await call('post', '/api/panel-types').send(longi).expect(201)
    ).body;

    expect(
      (
        await prisma.inverterProfile.findUniqueOrThrow({
          where: { id: profile.id },
        })
      ).householdId,
    ).toBe(householdId);
    expect(
      (
        await prisma.panelType.findUniqueOrThrow({
          where: { id: panelType.id },
        })
      ).householdId,
    ).toBe(householdId);
  });
});
