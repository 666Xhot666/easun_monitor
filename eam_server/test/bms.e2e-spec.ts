import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHash } from 'node:crypto';
import { decodeCellInfo } from '../src/bms/jk/cell-info';
import { referenceFrame } from '../src/bms/jk/testing/reference-frames';
import type { BmsReading } from '../src/bms/reading';
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

  /** A realistic reading: the reference's v19 frame, decoded, at `at`. */
  const reading = (
    at: Date,
    overrides: Partial<BmsReading> = {},
  ): BmsReading => ({
    timestamp: at.toISOString(),
    source: 'mac-ble',
    decoderVersion: 'jk-ble/1',
    ...decodeCellInfo(referenceFrame('CELL_INFO_JK02_32S_V19'), 'JK02_32S'),
    ...overrides,
  });

  const addDevice = async () =>
    (
      await call('post', `/api/inverter/profiles/${profileId}/bms`)
        .send({ name: 'Pack', sourceType: 'mac-ble' })
        .expect(201)
    ).body as { device: { id: number }; token: string };

  const ingest = (deviceToken: string | null, body: unknown) => {
    const req = request(app.getHttpServer()).post('/api/bms/ingest');
    return (
      deviceToken === null
        ? req
        : req.set('Authorization', `Bearer ${deviceToken}`)
    ).send(body as object);
  };

  describe('POST /api/bms/ingest', () => {
    it('needs the device token', async () => {
      await ingest(null, reading(new Date())).expect(401);
      await ingest('not-a-token', reading(new Date())).expect(401);
    });

    it('stores a reading for the device the token belongs to and marks it seen', async () => {
      const { device, token: deviceToken } = await addDevice();
      const at = new Date(Date.now() - 1000);

      const { body } = await ingest(deviceToken, reading(at)).expect(202);

      expect(body).toEqual({ stored: true });
      const rows = await prisma.bmsLog.findMany({
        where: { bmsDeviceId: device.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].timestamp.toISOString()).toBe(at.toISOString());
      expect(rows[0].payload).toMatchObject({
        stateOfChargePct: 100,
        currentA: -0.727,
        cellVoltagesV: expect.any(Array),
      });
      const seen = await prisma.bmsDevice.findUniqueOrThrow({
        where: { id: device.id },
      });
      expect(seen.lastSeenAt).not.toBeNull();
    });

    it('stores at most one reading per 30 s, accepting the rest for the live view', async () => {
      const { device, token: deviceToken } = await addDevice();
      const t0 = Date.now() - 60_000;

      await ingest(deviceToken, reading(new Date(t0))).expect(202, {
        stored: true,
      });
      await ingest(deviceToken, reading(new Date(t0 + 5_000))).expect(202, {
        stored: false,
      });
      await ingest(deviceToken, reading(new Date(t0 + 31_000))).expect(202, {
        stored: true,
      });

      expect(
        await prisma.bmsLog.count({ where: { bmsDeviceId: device.id } }),
      ).toBe(2);
    });
  });
});
