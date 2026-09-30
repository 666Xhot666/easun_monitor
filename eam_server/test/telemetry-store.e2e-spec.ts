import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelemetryStore } from '../src/telemetry/telemetry.store';
import { createTestApp, registerUser, resetDatabase, sampleProfile } from './helpers';

const HOUR = 3_600_000;
const t0 = new Date('2026-01-01T00:00:00Z').getTime();

describe('Telemetry store (e2e)', () => {
  let app: INestApplication<App>;
  let store: TelemetryStore;
  let prisma: PrismaService;
  let token: string;
  let profileId: number;
  let otherProfileId: number;

  beforeAll(async () => {
    app = await createTestApp();
    store = app.get(TelemetryStore);
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
    const create = (ipAddress: string) =>
      request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...sampleProfile, ipAddress })
        .expect(201);
    profileId = (await create('192.168.1.50')).body.id;
    otherProfileId = (await create('192.168.1.51')).body.id;
  });

  afterAll(() => app.close());

  /** One reading every `stepMs` from `start` for `count` readings. */
  const seed = (id: number, start: number, stepMs: number, count: number, pv: (i: number) => number) =>
    prisma.inverterLog.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        inverterProfileId: id,
        timestamp: new Date(start + i * stepMs),
        payload: { PVPower: pv(i), BatteryVoltage: 52, OperationMode: 2 },
      })),
    });

  it('records readings and returns the latest one', async () => {
    await store.record(profileId, { PVPower: 100 }, new Date(t0));
    await store.record(profileId, { PVPower: 200 }, new Date(t0 + 5000));
    await store.record(otherProfileId, { PVPower: 999 }, new Date(t0 + 9000));

    const latest = await store.latest(profileId);
    expect(latest?.payload).toEqual({ PVPower: 200 });
    expect(latest?.timestamp.getTime()).toBe(t0 + 5000);
  });

  it('downsamples short ranges from raw readings into evenly spaced averages', async () => {
    // 1 hour at 5 s: PVPower = minute index, so each 1-minute bucket averages to it.
    await seed(profileId, t0, 5000, 720, (i) => Math.floor(i / 12));
    await seed(otherProfileId, t0, 5000, 720, () => 5000);

    const history = await store.history(profileId, {
      from: new Date(t0),
      to: new Date(t0 + HOUR),
      maxPoints: 60,
      fields: ['PVPower'],
    });

    expect(history.source).toBe('raw');
    expect(history.bucketSeconds).toBe(60);
    expect(history.points).toHaveLength(60);
    expect(history.points[0]).toEqual({ timestamp: new Date(t0).toISOString(), values: { PVPower: 0 } });
    expect(history.points[59].values).toEqual({ PVPower: 59 });
  });

  it('answers long ranges from hourly rollups, weighting by sample count', async () => {
    // Two days: hour h has PVPower = h, one reading per minute.
    await seed(profileId, t0, 60_000, 48 * 60, (i) => Math.floor(i / 60));
    await store.rollUp();

    const history = await store.history(profileId, {
      from: new Date(t0),
      to: new Date(t0 + 30 * 24 * HOUR),
      maxPoints: 30,
      fields: ['PVPower'],
    });

    expect(history.source).toBe('hourly');
    expect(history.bucketSeconds).toBe(24 * 3600);
    // Only days with data are returned; day 1 averages hours 0-23, day 2 hours 24-47.
    expect(history.points.map((p) => p.values.PVPower)).toEqual([11.5, 35.5]);
  });

  it('never deletes raw readings when rolling up', async () => {
    await seed(profileId, t0, 60_000, 180, () => 1);
    await store.rollUp();
    await store.rollUp();
    expect(await prisma.inverterLog.count()).toBe(180);
  });

  it('serves history over HTTP for a requested range', async () => {
    await seed(profileId, t0, 5000, 720, () => 300);
    const res = await request(app.getHttpServer())
      .get(`/api/inverter/${profileId}/history`)
      .query({ from: new Date(t0).toISOString(), to: new Date(t0 + HOUR).toISOString(), points: 12 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.points).toHaveLength(12);
    expect(res.body.points[0].values).toMatchObject({ PVPower: 300, BatteryVoltage: 52 });
  });

  it('rejects an inverted range', async () => {
    await request(app.getHttpServer())
      .get(`/api/inverter/${profileId}/history`)
      .query({ from: new Date(t0 + HOUR).toISOString(), to: new Date(t0).toISOString() })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
