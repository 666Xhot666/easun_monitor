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
});
