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

describe('Household members (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminToken: string;
  let householdId: number;
  const ids: Record<string, number> = {};
  const tokens: Record<string, string> = {};

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
    for (const name of ['reader', 'second', 'stranger']) {
      tokens[name] = await registerUser(app, `${name}@example.com`);
      ids[name] = (
        await prisma.user.findUniqueOrThrow({
          where: { email: `${name}@example.com` },
        })
      ).id;
    }
    ids.admin = (
      await prisma.user.findUniqueOrThrow({
        where: { email: 'admin@example.com' },
      })
    ).id;
    for (const name of ['reader', 'second']) {
      const { code } = (
        await as(adminToken)
          .post(`/api/households/${householdId}/invites`)
          .send({ role: 'READER' })
          .expect(201)
      ).body;
      await as(tokens[name])
        .post('/api/households/join')
        .send({ code })
        .expect(201);
    }
  });

  afterAll(() => app.close());

  const as = (token: string) => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (path: string) => auth(request(server).get(path)),
      post: (path: string) => auth(request(server).post(path)),
      patch: (path: string) => auth(request(server).patch(path)),
      delete: (path: string) => auth(request(server).delete(path)),
    };
  };
  const path = (suffix = '') =>
    `/api/households/${householdId}/members${suffix}`;

  it('lists the members with their roles, to any member', async () => {
    const { body } = await as(tokens.reader).get(path()).expect(200);
    expect(body).toEqual([
      expect.objectContaining({
        userId: ids.admin,
        email: 'admin@example.com',
        role: 'ADMIN',
      }),
      expect.objectContaining({
        userId: ids.reader,
        email: 'reader@example.com',
        role: 'READER',
      }),
      expect.objectContaining({
        userId: ids.second,
        email: 'second@example.com',
        role: 'READER',
      }),
    ]);
    await as(tokens.stranger).get(path()).expect(404);
  });

  it('lets only admins change roles, and never drops the last admin', async () => {
    await as(tokens.reader)
      .patch(path(`/${ids.second}`))
      .send({ role: 'ADMIN' })
      .expect(403);
    await as(adminToken)
      .patch(path(`/${ids.admin}`))
      .send({ role: 'READER' })
      .expect(409);

    // The reader's own household was given up when they joined, so they may become an admin.
    const { body } = await as(adminToken)
      .patch(path(`/${ids.reader}`))
      .send({ role: 'ADMIN' })
      .expect(200);
    expect(body).toMatchObject({ userId: ids.reader, role: 'ADMIN' });
    await as(adminToken)
      .patch(path(`/${ids.reader}`))
      .send({ role: 'READER' })
      .expect(200);
  });

  it('refuses to make someone an admin who already runs another household', async () => {
    await as(tokens.stranger)
      .post('/api/inverter/setup')
      .send({ ...sampleProfile, ipAddress: '192.168.1.61' })
      .expect(201);
    const { code } = (
      await as(adminToken)
        .post(`/api/households/${householdId}/invites`)
        .send({ role: 'READER' })
        .expect(201)
    ).body;
    await as(tokens.stranger)
      .post('/api/households/join')
      .send({ code })
      .expect(201);

    await as(adminToken)
      .patch(path(`/${ids.stranger}`))
      .send({ role: 'ADMIN' })
      .expect(409);
  });

  it('lets admins remove members and members leave, but never the last admin', async () => {
    await as(tokens.reader)
      .delete(path(`/${ids.second}`))
      .expect(403);
    await as(tokens.second)
      .delete(path(`/${ids.second}`))
      .expect(200);
    await as(adminToken)
      .delete(path(`/${ids.stranger}`))
      .expect(200);
    await as(adminToken)
      .delete(path(`/${ids.admin}`))
      .expect(409);

    const { body } = await as(adminToken).get(path()).expect(200);
    expect(body.map((m: { email: string }) => m.email)).toEqual([
      'admin@example.com',
      'reader@example.com',
    ]);
  });
});
