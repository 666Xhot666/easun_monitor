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

describe('BMS devices (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let strangerToken: string;
  let profileId: number;

  // Users and profiles are made once: registration is rate-limited.
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
    strangerToken = await registerUser(app, 'stranger@example.com');
    profileId = (
      await call('post', '/api/inverter/setup').send(sampleProfile).expect(201)
    ).body.id;
  });

  beforeEach(() => prisma.bmsDevice.deleteMany());
  afterAll(() => app.close());

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    auth = token,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${auth}`);

  describe('adding a BMS to an inverter', () => {
    it('creates the device and shows its ingest token once, storing only a hash', async () => {
      const { body } = await call(
        'post',
        `/api/inverter/profiles/${profileId}/bms`,
      )
        .send({ name: 'House battery', sourceType: 'mac-ble' })
        .expect(201);

      expect(body.device).toMatchObject({
        id: expect.any(Number),
        name: 'House battery',
        sourceType: 'mac-ble',
        bluetoothId: null,
        lastSeenAt: null,
      });
      expect(body.device).not.toHaveProperty('tokenHash');
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

      const stored = await prisma.bmsDevice.findUniqueOrThrow({
        where: { id: body.device.id },
      });
      expect(stored.tokenHash).toBe(
        createHash('sha256').update(body.token).digest('hex'),
      );

      const list = await call(
        'get',
        `/api/inverter/profiles/${profileId}/bms`,
      ).expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({ id: body.device.id, name: 'House battery' }),
      ]);
      expect(JSON.stringify(list.body)).not.toContain(body.token);
      expect(list.body[0]).not.toHaveProperty('tokenHash');
    });

    it('validates the device', async () => {
      await call('post', `/api/inverter/profiles/${profileId}/bms`)
        .send({ name: '', sourceType: 'mac-ble' })
        .expect(400);
      await call('post', `/api/inverter/profiles/${profileId}/bms`)
        .send({ name: 'x', sourceType: 'zigbee' })
        .expect(400);
    });

    it("keeps other users' inverters and devices private", async () => {
      await call(
        'post',
        `/api/inverter/profiles/${profileId}/bms`,
        strangerToken,
      )
        .send({ name: 'Theirs', sourceType: 'esp32' })
        .expect(404);
      await call(
        'get',
        `/api/inverter/profiles/${profileId}/bms`,
        strangerToken,
      ).expect(404);
    });
  });
});
