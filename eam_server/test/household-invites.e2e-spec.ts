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

describe('Household invites (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminToken: string;
  let householdId: number;

  // Few users per file: registration is rate-limited.
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    adminToken = await registerUser(app, 'admin@example.com');
    householdId = (await as(adminToken).get('/api/auth/me').expect(200)).body
      .adminHouseholdId;
    await as(adminToken)
      .post('/api/inverter/setup')
      .send(sampleProfile)
      .expect(201);
  });

  afterAll(() => app.close());

  const as = (token: string) => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (path: string) => auth(request(server).get(path)),
      post: (path: string) => auth(request(server).post(path)),
      delete: (path: string) => auth(request(server).delete(path)),
    };
  };
  const invite = async (role: 'ADMIN' | 'READER') =>
    (
      await as(adminToken)
        .post(`/api/households/${householdId}/invites`)
        .send({ role })
        .expect(201)
    ).body as {
      invite: { id: number; role: string; expiresAt: string };
      code: string;
    };
  const membershipsOf = async (email: string) =>
    (
      await prisma.user.findUniqueOrThrow({
        where: { email },
        include: { memberships: true },
      })
    ).memberships;

  it('creates an invite whose code is shown once and stored only as a hash', async () => {
    const { invite: created, code } = await invite('READER');

    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(created.role).toBe('READER');
    expect(Date.parse(created.expiresAt) - Date.now()).toBeGreaterThan(
      6.9 * 86_400_000,
    );
    const stored = await prisma.householdInvite.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(JSON.stringify(stored)).not.toContain(code);

    const open = (
      await as(adminToken)
        .get(`/api/households/${householdId}/invites`)
        .expect(200)
    ).body;
    expect(open).toEqual([
      expect.objectContaining({ id: created.id, role: 'READER' }),
    ]);
    expect(JSON.stringify(open)).not.toContain(code);
  });

  it('registers a new user straight into the household, without a household of their own', async () => {
    const { code } = await invite('READER');

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'invited@example.com',
        password: 'correct-horse-battery',
        inviteCode: code,
      })
      .expect(201);

    expect(await membershipsOf('invited@example.com')).toEqual([
      expect.objectContaining({ householdId, role: 'READER' }),
    ]);
    const me = (await as(res.body.accessToken).get('/api/auth/me').expect(200))
      .body;
    expect(me.adminHouseholdId).toBeNull();
    expect(me.inverterProfiles).toHaveLength(1);
  });

  it('lets an existing user join, removing their own household while it has no inverters', async () => {
    const userToken = await registerUser(app, 'joiner@example.com');
    const [own] = await membershipsOf('joiner@example.com');
    const { code } = await invite('ADMIN');

    const { body } = await as(userToken)
      .post('/api/households/join')
      .send({ code: code.toLowerCase() })
      .expect(201);

    expect(body).toEqual({ householdId, role: 'ADMIN' });
    expect(await membershipsOf('joiner@example.com')).toEqual([
      expect.objectContaining({ householdId, role: 'ADMIN' }),
    ]);
    expect(
      await prisma.household.findUnique({ where: { id: own.householdId } }),
    ).toBeNull();
  });

  it('keeps a reader in several households, but one household per admin', async () => {
    const otherToken = await registerUser(app, 'other-admin@example.com');
    await as(otherToken)
      .post('/api/inverter/setup')
      .send({ ...sampleProfile, ipAddress: '192.168.1.60' })
      .expect(201);

    await as(otherToken)
      .post('/api/households/join')
      .send({ code: (await invite('ADMIN')).code })
      .expect(409);
    await as(otherToken)
      .post('/api/households/join')
      .send({ code: (await invite('READER')).code })
      .expect(201);

    expect(
      (await membershipsOf('other-admin@example.com'))
        .map((m) => m.role)
        .sort(),
    ).toEqual(['ADMIN', 'READER']);
  });

  it('refuses codes that are used, revoked, expired or unknown, and creates nothing', async () => {
    const userToken = await registerUser(app, 'late@example.com');
    const used = await invite('READER');
    await as(userToken)
      .post('/api/households/join')
      .send({ code: used.code })
      .expect(201);
    await as(userToken)
      .post('/api/households/join')
      .send({ code: used.code })
      .expect(400);

    const revoked = await invite('READER');
    await as(adminToken)
      .delete(`/api/households/${householdId}/invites/${revoked.invite.id}`)
      .expect(200);
    await as(userToken)
      .post('/api/households/join')
      .send({ code: revoked.code })
      .expect(400);

    const expired = await invite('READER');
    await prisma.householdInvite.update({
      where: { id: expired.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'never@example.com',
        password: 'correct-horse-battery',
        inviteCode: expired.code,
      })
      .expect(400);
    expect(
      await prisma.user.findUnique({ where: { email: 'never@example.com' } }),
    ).toBeNull();

    await as(userToken)
      .post('/api/households/join')
      .send({ code: 'NOPE-NOPE' })
      .expect(400);
  });

  it('lets only admins manage invites', async () => {
    const readerToken = (
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'just-reader@example.com',
          password: 'correct-horse-battery',
          inviteCode: (await invite('READER')).code,
        })
        .expect(201)
    ).body.accessToken;

    await as(readerToken)
      .post(`/api/households/${householdId}/invites`)
      .send({ role: 'READER' })
      .expect(403);
    await as(readerToken)
      .get(`/api/households/${householdId}/invites`)
      .expect(403);
    await as(readerToken)
      .post(`/api/households/999999/invites`)
      .send({ role: 'READER' })
      .expect(404);
  });
});
