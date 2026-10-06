import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelemetryStore } from '../src/telemetry/telemetry.store';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

const t0 = new Date('2026-10-05T00:00:00Z').getTime();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe('Energy totals (e2e)', () => {
  let app: INestApplication<App>;
  let store: TelemetryStore;
  let prisma: PrismaService;
  let token: string;
  let strangerToken: string;
  let profileId: number;
  let otherProfileId: number;

  // Users and profiles are made once: registration is rate-limited.
  beforeAll(async () => {
    app = await createTestApp();
    store = app.get(TelemetryStore);
    prisma = app.get(PrismaService);
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

  /** Readings every `stepMs` from `start`; `payload(i)` gives each one. */
  const seed = (
    id: number,
    start: number,
    stepMs: number,
    count: number,
    payload: (i: number) => Record<string, number>,
  ) =>
    prisma.inverterLog.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        inverterProfileId: id,
        timestamp: new Date(start + i * stepMs),
        payload: payload(i),
      })),
    });

  const range = (hours: number) => ({
    from: new Date(t0),
    to: new Date(t0 + hours * HOUR),
  });

  describe('TelemetryStore.energy', () => {
    it('integrates each power over time between consecutive readings', async () => {
      // One hour at 5 s: 721 readings span exactly 3600 s.
      await seed(profileId, t0, 5 * SECOND, 721, () => ({
        PVPower: 1000,
        AverageMainsPower: 250,
        OutputActivePower: 1200,
      }));
      await seed(otherProfileId, t0, 5 * SECOND, 721, () => ({
        PVPower: 9999,
      }));

      const energy = await store.energy(profileId, range(2));

      expect(energy.pvKWh).toBeCloseTo(1, 6);
      expect(energy.gridKWh).toBeCloseTo(0.25, 6);
      expect(energy.outputKWh).toBeCloseTo(1.2, 6);
    });

    it('follows a ramp with the trapezoid rule', async () => {
      // PV rising linearly from 0 to 3600 W over an hour, a reading a minute: 1.8 kWh.
      await seed(profileId, t0, MINUTE, 61, (i) => ({ PVPower: i * 60 }));

      expect((await store.energy(profileId, range(2))).pvKWh).toBeCloseTo(
        1.8,
        6,
      );
    });

    it('is zero with no readings', async () => {
      expect(await store.energy(profileId, range(1))).toEqual({
        pvKWh: 0,
        gridKWh: 0,
        outputKWh: 0,
        coveredSeconds: 0,
      });
    });
  });
});
