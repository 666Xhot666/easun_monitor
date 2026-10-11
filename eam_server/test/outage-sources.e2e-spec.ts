import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHash } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

const ADDRESS = { city: 'м. Дніпро', street: 'вул. Тестова', house: '12а' };
const STREETS = {
  'м. Дніпро': ['вул. Тестова', 'пров. Ясний'],
  'с. Філія': ['вул. Лісова'],
  'м. Апостолове': ['вул. Центральна'],
};

describe('Outage schedule source (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let reader: string;
  let stranger: string;
  let profileId: number;

  // Users and the profile are made once: registration is rate-limited.
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    admin = await registerUser(app, 'admin@example.com');
    reader = await registerUser(app, 'reader@example.com');
    stranger = await registerUser(app, 'stranger@example.com');
    profileId = (
      await call('post', '/api/inverter/setup', admin)
        .send(sampleProfile)
        .expect(201)
    ).body.id;

    // The reader joins the admin's household as a reader.
    const { householdId } = await prisma.inverterProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    const readerUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'reader@example.com' },
    });
    await prisma.membership.create({
      data: { userId: readerUser.id, householdId, role: 'READER' },
    });
  });

  beforeEach(async () => {
    await prisma.outageSource.deleteMany();
    await prisma.outageSiteStreets.deleteMany();
  });
  afterAll(() => app.close());

  const call = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    auth: string,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${auth}`);

  const sourcePath = () => `/api/inverter/profiles/${profileId}/outage-source`;

  /** Sets the address up and returns the reader's token. */
  async function setUp(address: object = ADDRESS): Promise<string> {
    const { body } = await call('put', sourcePath(), admin)
      .send(address)
      .expect(200);
    return body.token as string;
  }

  describe('setting the address', () => {
    it('creates the source and shows the reader token once, storing only a hash', async () => {
      const { body } = await call('put', sourcePath(), admin)
        .send(ADDRESS)
        .expect(200);

      expect(body.source).toEqual({
        id: expect.any(Number),
        site: 'dnem',
        ...ADDRESS,
        enabled: true,
        houseState: 'PENDING',
        groups: [],
        lastSeenAt: null,
      });
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      const stored = await prisma.outageSource.findUniqueOrThrow({
        where: { id: body.source.id },
      });
      expect(stored.tokenHash).toBe(
        createHash('sha256').update(body.token).digest('hex'),
      );

      const read = await call('get', sourcePath(), admin).expect(200);
      expect(read.body).toEqual({ source: body.source });
    });

    it('has no source until one is set', async () => {
      const { body } = await call('get', sourcePath(), admin).expect(200);
      expect(body).toEqual({ source: null });
    });

    it('changes the address without a new token, and looks the house up again', async () => {
      await setUp();
      await prisma.outageSource.updateMany({
        data: { houseState: 'FOUND', groups: ['GPV5.2'] },
      });

      const { body } = await call('put', sourcePath(), admin)
        .send({ ...ADDRESS, house: '14' })
        .expect(200);
      expect(body).not.toHaveProperty('token');
      expect(body.source).toMatchObject({
        house: '14',
        houseState: 'PENDING',
        groups: [],
      });
    });

    it('can be switched off and on, keeping what was found', async () => {
      await setUp();
      await prisma.outageSource.updateMany({
        data: { houseState: 'FOUND', groups: ['GPV5.2'] },
      });
      const { body } = await call('put', sourcePath(), admin)
        .send({ ...ADDRESS, enabled: false })
        .expect(200);
      expect(body.source).toMatchObject({
        enabled: false,
        houseState: 'FOUND',
        groups: ['GPV5.2'],
      });
    });

    it('needs the whole address', async () => {
      await call('put', sourcePath(), admin)
        .send({ city: ADDRESS.city, street: ADDRESS.street })
        .expect(400);
      await call('put', sourcePath(), admin)
        .send({ ...ADDRESS, house: '  ' })
        .expect(400);
    });

    it("checks the city and street against the site's list once the reader has sent it", async () => {
      const token = await setUp();
      await call('put', '/api/outage/reader/streets', token)
        .send({ site: 'dnem', streets: STREETS })
        .expect(200);

      await call('put', sourcePath(), admin)
        .send({ ...ADDRESS, city: 'м. Нідеє' })
        .expect(400);
      await call('put', sourcePath(), admin)
        .send({ ...ADDRESS, street: 'вул. Лісова' })
        .expect(400);
      await call('put', sourcePath(), admin).send(ADDRESS).expect(200);
    });

    it('replaces the reader token; the old one stops working', async () => {
      const old = await setUp();
      const { body } = await call(
        'post',
        `${sourcePath()}/token`,
        admin,
      ).expect(201);
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      await call('get', '/api/outage/reader/source', old).expect(401);
      await call('get', '/api/outage/reader/source', body.token).expect(200);
    });

    it('removes the source', async () => {
      await setUp();
      await call('delete', sourcePath(), admin).expect(204);
      const { body } = await call('get', sourcePath(), admin).expect(200);
      expect(body).toEqual({ source: null });
    });
  });

  describe('who may do what', () => {
    it('lets a reader of the household see the source but not change it', async () => {
      await setUp();
      await call('get', sourcePath(), reader).expect(200);
      await call('put', sourcePath(), reader).send(ADDRESS).expect(403);
      await call('post', `${sourcePath()}/token`, reader).expect(403);
      await call('delete', sourcePath(), reader).expect(403);
    });

    it('shows nothing to someone outside the household', async () => {
      await setUp();
      await call('get', sourcePath(), stranger).expect(404);
      await call('put', sourcePath(), stranger).send(ADDRESS).expect(404);
    });

    it('needs a signed-in user for the city and street lists', async () => {
      await request(app.getHttpServer()).get('/api/outage/cities').expect(401);
    });
  });

  describe('the reader', () => {
    it('asks which address to check, and is seen doing so', async () => {
      const token = await setUp();
      const { body } = await call(
        'get',
        '/api/outage/reader/source',
        token,
      ).expect(200);
      expect(body).toEqual({
        site: 'dnem',
        ...ADDRESS,
        enabled: true,
        refresh: false,
      });

      const source = await call('get', sourcePath(), admin).expect(200);
      expect(new Date(source.body.source.lastSeenAt).getTime()).toBeGreaterThan(
        Date.now() - 60_000,
      );
    });

    it('is turned away without a valid token', async () => {
      await call('get', '/api/outage/reader/source', 'nope').expect(401);
      await request(app.getHttpServer())
        .get('/api/outage/reader/source')
        .expect(401);
      // A user session is not a reader token.
      await call('get', '/api/outage/reader/source', admin).expect(401);
    });

    it("uploads the site's streets, which fill the pickers", async () => {
      const token = await setUp();
      await call('put', '/api/outage/reader/streets', token)
        .send({ site: 'dnem', streets: STREETS })
        .expect(200);

      const cities = await call('get', '/api/outage/cities', reader).expect(
        200,
      );
      expect(cities.body).toEqual(['м. Апостолове', 'м. Дніпро', 'с. Філія']);
      const streets = await call(
        'get',
        `/api/outage/streets?city=${encodeURIComponent('м. Дніпро')}`,
        reader,
      ).expect(200);
      expect(streets.body).toEqual(['вул. Тестова', 'пров. Ясний']);
      await call(
        'get',
        `/api/outage/streets?city=${encodeURIComponent('м. Нідеє')}`,
        reader,
      ).expect(404);
    });

    it('has empty pickers before the first upload', async () => {
      const { body } = await call('get', '/api/outage/cities', admin).expect(
        200,
      );
      expect(body).toEqual([]);
    });

    it('takes a list the size of the real one', async () => {
      const token = await setUp();
      const big: Record<string, string[]> = {};
      for (let c = 0; c < 1200; c++) {
        big[`с. Місто ${c}`] = Array.from(
          { length: 16 },
          (_, s) => `вул. Вулиця номер ${s}`,
        );
      }
      expect(JSON.stringify(big).length).toBeGreaterThan(300_000);
      await call('put', '/api/outage/reader/streets', token)
        .send({ site: 'dnem', streets: big })
        .expect(200);
      const { body } = await call('get', '/api/outage/cities', admin).expect(
        200,
      );
      expect(body).toHaveLength(1200);
    });

    it('leaves an unchanged list alone', async () => {
      const token = await setUp();
      await call('put', '/api/outage/reader/streets', token)
        .send({ site: 'dnem', streets: STREETS })
        .expect(200);
      const first = await prisma.outageSiteStreets.findUniqueOrThrow({
        where: { site: 'dnem' },
      });
      const again = await call('put', '/api/outage/reader/streets', token)
        .send({ site: 'dnem', streets: STREETS })
        .expect(200);
      expect(again.body).toEqual({ changed: false });
      const second = await prisma.outageSiteStreets.findUniqueOrThrow({
        where: { site: 'dnem' },
      });
      expect(second.updatedAt).toEqual(first.updatedAt);
    });

    it('rejects a list that is not cities with lists of streets', async () => {
      const token = await setUp();
      for (const streets of [
        { 'м. Дніпро': 'вул. Тестова' },
        { 'м. Дніпро': [1, 2] },
        ['м. Дніпро'],
      ]) {
        await call('put', '/api/outage/reader/streets', token)
          .send({ site: 'dnem', streets })
          .expect(400);
      }
      await call('put', '/api/outage/reader/streets', token)
        .send({ site: 'kem', streets: STREETS })
        .expect(400);
    });
  });
});
