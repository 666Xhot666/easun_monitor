import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, registerUser, resetDatabase } from './helpers';

describe('Server owner and viewers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: string;
  let other: string;
  let otherId: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    owner = await registerUser(app, 'first@example.com');
    other = await registerUser(app, 'second@example.com');
    otherId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: 'second@example.com' },
      })
    ).id;
  });
  afterAll(() => app.close());

  const me = async (token: string) =>
    (
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body;
  const call = (method: 'get' | 'put', path: string, token: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);

  it('makes the first account of the installation its owner, and nobody else', async () => {
    expect((await me(owner)).server).toBe('OWNER');
    expect((await me(other)).server).toBeNull();
    expect(await prisma.serverOwner.count()).toBe(1);
  });

  it('lets the owner see every account and choose who may look at the server', async () => {
    const { body } = await call('get', '/api/server/users', owner).expect(200);
    expect(body).toEqual([
      {
        id: expect.any(Number),
        email: 'first@example.com',
        owner: true,
        viewer: false,
      },
      { id: otherId, email: 'second@example.com', owner: false, viewer: false },
    ]);

    await call('put', `/api/server/users/${otherId}`, owner)
      .send({ viewer: true })
      .expect(200);
    expect((await me(other)).server).toBe('VIEWER');

    await call('put', `/api/server/users/${otherId}`, owner)
      .send({ viewer: false })
      .expect(200);
    expect((await me(other)).server).toBeNull();
  });

  it('is for the owner only', async () => {
    await call('get', '/api/server/users', other).expect(403);
    await call('put', `/api/server/users/${otherId}`, other)
      .send({ viewer: true })
      .expect(403);
    // A viewer only looks.
    await prisma.user.update({
      where: { id: otherId },
      data: { serverViewer: true },
    });
    await call('get', '/api/server/users', other).expect(403);
  });

  it("does not change the owner's own access, or an unknown account", async () => {
    const ownerId = (await me(owner)).id;
    await call('put', `/api/server/users/${ownerId}`, owner)
      .send({ viewer: false })
      .expect(400);
    await call('put', '/api/server/users/99999', owner)
      .send({ viewer: true })
      .expect(404);
    await call('put', `/api/server/users/${otherId}`, owner)
      .send({ viewer: 'yes' })
      .expect(400);
  });
});
