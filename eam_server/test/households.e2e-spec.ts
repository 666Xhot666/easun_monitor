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

  describe('GET /api/auth/me', () => {
    it("lists the user's households and the inverters of all of them, with the user's role", async () => {
      const readerToken = await registerUser(app, 'me-reader@example.com');
      const reader = await prisma.user.findUniqueOrThrow({
        where: { email: 'me-reader@example.com' },
      });
      const ownerUser = await owner();
      const householdId = ownerUser.memberships[0].householdId;
      await prisma.membership.create({
        data: { userId: reader.id, householdId, role: 'READER' },
      });

      const me = (
        await request(app.getHttpServer())
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${readerToken}`)
          .expect(200)
      ).body;

      expect(me.adminHouseholdId).toEqual(expect.any(Number));
      expect(me.households).toEqual(
        expect.arrayContaining([
          { id: householdId, name: 'Home', role: 'READER' },
          { id: me.adminHouseholdId, name: 'Home', role: 'ADMIN' },
        ]),
      );
      expect(me.inverterProfiles).toEqual([
        expect.objectContaining({
          householdId,
          role: 'READER',
          name: sampleProfile.name,
        }),
      ]);

      const ownMe = (await call('get', '/api/auth/me').expect(200)).body;
      expect(ownMe.inverterProfiles).toEqual([
        expect.objectContaining({ householdId, role: 'ADMIN' }),
      ]);
    });
  });

  describe('pairing an inverter', () => {
    it('is refused to a user without a household of their own', async () => {
      const guestToken = await registerUser(app, 'guest@example.com');
      const guest = await prisma.user.findUniqueOrThrow({
        where: { email: 'guest@example.com' },
        include: { memberships: true },
      });
      await prisma.household.delete({
        where: { id: guest.memberships[0].householdId },
      });

      const res = await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ ...sampleProfile, ipAddress: '192.168.1.77' })
        .expect(403);
      expect(res.body.message).toMatch(/household/i);
    });
  });
});
