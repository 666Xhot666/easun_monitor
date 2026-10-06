import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelemetryStore } from '../src/telemetry/telemetry.store';
import { createTestApp, registerUser, resetDatabase, sampleProfile } from './helpers';

const t0 = new Date('2026-10-05T00:00:00Z').getTime();
const MINUTE = 60_000;

describe('Readings log (e2e)', () => {
  let app: INestApplication<App>;
  let store: TelemetryStore;
  let prisma: PrismaService;
  let token: string;
  let strangerToken: string;
  let profileId: number;
  let otherProfileId: number;

  beforeAll(async () => {
    app = await createTestApp();
    store = app.get(TelemetryStore);
    prisma = app.get(PrismaService);
    // Users and profiles are made once: registration is rate-limited.
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
    strangerToken = await registerUser(app, 'stranger@example.com');
    const create = (ipAddress: string) =>
      request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...sampleProfile, ipAddress })
        .expect(201);
    profileId = (await create('192.168.1.50')).body.id;
    otherProfileId = (await create('192.168.1.51')).body.id;
  });

  beforeEach(() => prisma.inverterLog.deleteMany());

  afterAll(() => app.close());

  /** One reading a minute from `start`, PVPower = its index. */
  const seed = (id: number, start: number, count: number) =>
    prisma.inverterLog.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        inverterProfileId: id,
        timestamp: new Date(start + i * MINUTE),
        payload: { PVPower: i, OperationMode: 2 },
      })),
    });

  describe('TelemetryStore.readings', () => {
    it('lists one inverter\'s readings in a range, newest first', async () => {
      await seed(profileId, t0 - 2 * MINUTE, 10); // two before the range
      await seed(otherProfileId, t0, 10);

      const page = await store.readings(profileId, {
        from: new Date(t0),
        to: new Date(t0 + 5 * MINUTE),
        limit: 100,
      });

      expect(page.map((r) => r.payload.PVPower)).toEqual([6, 5, 4, 3, 2]);
      expect(page[0].timestamp.toISOString()).toBe(new Date(t0 + 4 * MINUTE).toISOString());
    });

    it('pages backwards from the oldest reading already shown', async () => {
      await seed(profileId, t0, 10);
      const range = { from: new Date(t0), to: new Date(t0 + 10 * MINUTE) };

      const first = await store.readings(profileId, { ...range, limit: 4 });
      const second = await store.readings(profileId, { ...range, limit: 4, before: first[3].timestamp });

      expect(first.map((r) => r.payload.PVPower)).toEqual([9, 8, 7, 6]);
      expect(second.map((r) => r.payload.PVPower)).toEqual([5, 4, 3, 2]);
    });
  });

  describe('GET /api/inverter/:profileId/readings', () => {
    const get = (path: string, auth = token) =>
      request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${auth}`);
    const range = `from=${new Date(t0).toISOString()}&to=${new Date(t0 + 10 * MINUTE).toISOString()}`;

    it('returns a page of readings in the range, newest first', async () => {
      await seed(profileId, t0, 10);

      const { body } = await get(`/api/inverter/${profileId}/readings?${range}&limit=3`).expect(200);

      expect(body.map((r: { payload: { PVPower: number } }) => r.payload.PVPower)).toEqual([9, 8, 7]);
      expect(body[0]).toEqual({
        id: expect.any(Number),
        timestamp: new Date(t0 + 9 * MINUTE).toISOString(),
        payload: { PVPower: 9, OperationMode: 2 },
      });

      const next = await get(`/api/inverter/${profileId}/readings?${range}&limit=3&before=${body[2].timestamp}`).expect(200);
      expect(next.body.map((r: { payload: { PVPower: number } }) => r.payload.PVPower)).toEqual([6, 5, 4]);
    });

    it('needs a range of at most 31 days', async () => {
      await get(`/api/inverter/${profileId}/readings`).expect(400);
      const to = new Date(t0 + 32 * 24 * 60 * MINUTE).toISOString();
      await get(`/api/inverter/${profileId}/readings?from=${new Date(t0).toISOString()}&to=${to}`).expect(400);
      await get(`/api/inverter/${profileId}/readings?${range}&limit=501`).expect(400);
    });

    it("hides another user's readings", async () => {
      await seed(profileId, t0, 3);
      await get(`/api/inverter/${profileId}/readings?${range}`, strangerToken).expect(404);
    });
  });

  describe('GET /api/inverter/:profileId/readings/export', () => {
    const get = (path: string, auth = token) =>
      request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${auth}`);
    const range = (minutes: number) =>
      `from=${new Date(t0).toISOString()}&to=${new Date(t0 + minutes * MINUTE).toISOString()}`;

    it('downloads the range as CSV, oldest first, in the given time zone', async () => {
      await seed(profileId, t0, 3);
      await seed(otherProfileId, t0, 3);

      const res = await get(`/api/inverter/${profileId}/readings/export?${range(10)}&tz=Europe/Rome`).expect(200);

      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="readings-.*\.csv"$/);
      const lines = res.text.split('\r\n');
      expect(lines[0]).toMatch(/^\uFEFFTime \(Europe\/Rome\),/);
      expect(lines.slice(1, 4).map((l) => l.slice(0, 19))).toEqual([
        '2026-10-05 02:00:00',
        '2026-10-05 02:01:00',
        '2026-10-05 02:02:00',
      ]);
      expect(lines[1]).toContain(',Mains,');
      expect(lines).toHaveLength(5); // header, 3 rows, trailing empty
    });

    it('streams every reading of a long range', async () => {
      await seed(profileId, t0, 2500);

      const res = await get(`/api/inverter/${profileId}/readings/export?${range(3000)}`).expect(200);

      expect(res.text.split('\r\n')).toHaveLength(2502);
      expect(res.text.split('\r\n')[0]).toMatch(/Time \(UTC\)/);
    });

    it('refuses unknown time zones and ranges over 31 days', async () => {
      await get(`/api/inverter/${profileId}/readings/export?${range(10)}&tz=Mars/Olympus`).expect(400);
      await get(`/api/inverter/${profileId}/readings/export?${range(32 * 24 * 60)}`).expect(400);
    });

    it("hides another user's readings", async () => {
      await get(`/api/inverter/${profileId}/readings/export?${range(10)}`, strangerToken).expect(404);
    });
  });
});
