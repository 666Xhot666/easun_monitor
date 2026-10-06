import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHash } from 'node:crypto';
import { decodeCellInfo } from '../src/bms/jk/cell-info';
import { referenceFrame } from '../src/bms/jk/testing/reference-frames';
import type { BmsReading } from '../src/bms/reading';
import { BmsStore } from '../src/bms/bms.store';
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

    it('rejects implausible values', async () => {
      const { token: deviceToken } = await addDevice();
      const at = new Date(Date.now() - 1000);
      await ingest(deviceToken, reading(at, { stateOfChargePct: 150 })).expect(
        400,
      );
      await ingest(
        deviceToken,
        reading(at, { cellVoltagesV: [3.3, 9.1] }),
      ).expect(400);
      await ingest(deviceToken, reading(at, { packVoltageV: -2 })).expect(400);
      await ingest(deviceToken, { ...reading(at), extra: 1 }).expect(400);
    });

    it('rejects readings from the future or older than an hour', async () => {
      const { token: deviceToken } = await addDevice();
      await ingest(deviceToken, reading(new Date(Date.now() + 120_000))).expect(
        400,
      );
      await ingest(
        deviceToken,
        reading(new Date(Date.now() - 2 * 3_600_000)),
      ).expect(400);
      await ingest(
        deviceToken,
        reading(new Date(Date.now() - 10 * 60_000)),
      ).expect(202);
    });

    it('stores a re-sent reading only once', async () => {
      const { device, token: deviceToken } = await addDevice();
      const at = new Date(Date.now() - 1000);
      await ingest(deviceToken, reading(at)).expect(202, { stored: true });
      await ingest(deviceToken, reading(at)).expect(202, { stored: false });
      expect(
        await prisma.bmsLog.count({ where: { bmsDeviceId: device.id } }),
      ).toBe(1);
    });

    it('limits how often one device may post', async () => {
      const { token: deviceToken } = await addDevice();
      const statuses: number[] = [];
      for (let i = 0; i < 125; i++) {
        statuses.push(
          (await ingest(deviceToken, reading(new Date(Date.now() - 1000 + i))))
            .status,
        );
      }
      expect(statuses.slice(0, 120).every((s) => s === 202)).toBe(true);
      expect(statuses.slice(120)).toEqual([429, 429, 429, 429, 429]);
    });
  });

  describe('reading it back', () => {
    const base = (bmsId: number) =>
      `/api/inverter/profiles/${profileId}/bms/${bmsId}`;

    it('serves the newest reading, live while it is under 30 s old', async () => {
      const { device, token: deviceToken } = await addDevice();
      await call('get', `${base(device.id)}/latest`).expect(404);

      await ingest(deviceToken, reading(new Date(Date.now() - 2_000))).expect(
        202,
      );
      const live = await call('get', `${base(device.id)}/latest`).expect(200);
      expect(live.body).toMatchObject({
        status: 'live',
        reading: { stateOfChargePct: 100 },
      });
      expect(live.body.ageSeconds).toBeLessThan(30);

      const { device: other, token: otherToken } = await addDevice();
      await ingest(otherToken, reading(new Date(Date.now() - 45_000))).expect(
        202,
      );
      const stale = await call('get', `${base(other.id)}/latest`).expect(200);
      expect(stale.body.status).toBe('stale');
      expect(stale.body.ageSeconds).toBeGreaterThanOrEqual(45);

      await call('get', `${base(device.id)}/latest`, strangerToken).expect(404);
    });

    it('serves history from stored readings, and hourly averages for long ranges', async () => {
      const { device } = await addDevice();
      const t0 = new Date('2026-10-01T00:00:00Z').getTime();
      // Three days, one reading every 30 s, SOC rising 0..99 within each hour.
      await prisma.bmsLog.createMany({
        data: Array.from({ length: 3 * 24 * 120 }, (_, i) => ({
          bmsDeviceId: device.id,
          timestamp: new Date(t0 + i * 30_000),
          payload: {
            stateOfChargePct: (i % 120) * (99 / 119),
            packVoltageV: 26.5,
            cellVoltagesV: [3.3, 3.31],
          },
        })),
      });

      const hour = await call(
        'get',
        `${base(device.id)}/history?from=${new Date(t0).toISOString()}&to=${new Date(t0 + 3_600_000).toISOString()}&points=60&fields=stateOfChargePct`,
      ).expect(200);
      expect(hour.body.source).toBe('raw');
      expect(hour.body.points).toHaveLength(60);
      expect(Object.keys(hour.body.points[0].values)).toEqual([
        'stateOfChargePct',
      ]);

      await app.get(BmsStore).rollUp();
      const days = await call(
        'get',
        `${base(device.id)}/history?from=${new Date(t0).toISOString()}&to=${new Date(t0 + 3 * 86_400_000).toISOString()}&points=72`,
      ).expect(200);
      expect(days.body.source).toBe('hourly');
      expect(days.body.points).toHaveLength(72);
      expect(days.body.points[0].values.stateOfChargePct).toBeCloseTo(49.5, 1);
      expect(days.body.points[0].values.packVoltageV).toBeCloseTo(26.5, 3);

      await call(
        'get',
        `${base(device.id)}/history?from=${new Date(t0).toISOString()}`,
        strangerToken,
      ).expect(404);
    });
  });
});
