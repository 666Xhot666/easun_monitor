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

    it('leaves out gaps longer than 10 minutes instead of guessing across them', async () => {
      // 1000 W for 10 minutes, the logger offline for 2 hours, then 1000 W for 10 minutes.
      await seed(profileId, t0, MINUTE, 11, () => ({ PVPower: 1000 }));
      await seed(profileId, t0 + 2 * HOUR + 10 * MINUTE, MINUTE, 11, () => ({
        PVPower: 1000,
      }));

      const energy = await store.energy(profileId, range(3));

      expect(energy.pvKWh).toBeCloseTo(20 / 60, 6);
      expect(energy.coveredSeconds).toBe(20 * 60);
    });

    it('bridges a few missed polls', async () => {
      await seed(profileId, t0, MINUTE, 2, () => ({ PVPower: 600 }));
      await seed(profileId, t0 + 10 * MINUTE, MINUTE, 1, () => ({
        PVPower: 600,
      })); // 9 minutes after the last

      expect((await store.energy(profileId, range(1))).pvKWh).toBeCloseTo(
        0.1,
        6,
      );
    });

    it('counts grid import only, and never negative PV or load', async () => {
      await seed(profileId, t0, MINUTE, 61, (i) =>
        i < 30
          ? { PVPower: -5, AverageMainsPower: -400, OutputActivePower: -3 }
          : { PVPower: 1200, AverageMainsPower: 600, OutputActivePower: 1800 },
      );

      const energy = await store.energy(profileId, range(2));

      // The 30th minute ramps from the clamped 0 up: half a minute at full power.
      expect(energy.pvKWh).toBeCloseTo((1200 * 30.5) / 60 / 1000, 6);
      expect(energy.gridKWh).toBeCloseTo((600 * 30.5) / 60 / 1000, 6);
      expect(energy.outputKWh).toBeCloseTo((1800 * 30.5) / 60 / 1000, 6);
    });

    it('skips a field only where a reading lacks it', async () => {
      await seed(profileId, t0, MINUTE, 61, (i): Record<string, number> =>
        i >= 30 && i < 40
          ? { OutputActivePower: 600 }
          : { PVPower: 600, OutputActivePower: 600 },
      );

      const energy = await store.energy(profileId, range(2));

      expect(energy.outputKWh).toBeCloseTo(0.6, 6);
      expect(energy.pvKWh).toBeCloseTo((600 * 49) / 60 / 1000, 6); // 11 one-minute pairs touch a reading without PV
    });

    it('integrates battery charge and discharge separately, from voltage and signed current', async () => {
      // Half an hour charging at 26 V x 20 A, then half an hour discharging at 25 V x 10 A.
      await seed(profileId, t0, MINUTE, 61, (i) =>
        i <= 30
          ? { BatteryVoltage: 26, BatteryCurrentSigned: i === 30 ? 0 : 20 }
          : { BatteryVoltage: 25, BatteryCurrentSigned: -10 },
      );

      const energy = await store.energy(profileId, range(2));

      // The 30th-31st minute ramps from 0 to -250 W: half a minute of discharge.
      expect(energy.batteryChargeKWh).toBeCloseTo((520 * 29.5) / 60 / 1000, 6);
      expect(energy.batteryDischargeKWh).toBeCloseTo(
        (250 * 29.5) / 60 / 1000,
        6,
      );
    });

    it('is zero with no readings', async () => {
      expect(await store.energy(profileId, range(1))).toEqual({
        pvKWh: 0,
        gridKWh: 0,
        outputKWh: 0,
        batteryChargeKWh: 0,
        batteryDischargeKWh: 0,
        coveredSeconds: 0,
      });
    });
  });

  describe('GET /api/inverter/:profileId/energy', () => {
    const get = (path: string, auth = token) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${auth}`);
    const query = (hours: number) =>
      `from=${new Date(t0).toISOString()}&to=${new Date(t0 + hours * HOUR).toISOString()}`;

    it('returns the energy totals for the range', async () => {
      await seed(profileId, t0, MINUTE, 61, () => ({
        PVPower: 1000,
        AverageMainsPower: 0,
        OutputActivePower: 500,
      }));

      const { body } = await get(
        `/api/inverter/${profileId}/energy?${query(24)}`,
      ).expect(200);

      expect(body).toEqual({
        pvKWh: expect.closeTo(1, 6),
        gridKWh: 0,
        outputKWh: expect.closeTo(0.5, 6),
        batteryChargeKWh: 0,
        batteryDischargeKWh: 0,
        coveredSeconds: 3600,
      });
    });

    it('needs a range of at most 31 days', async () => {
      await get(`/api/inverter/${profileId}/energy`).expect(400);
      await get(`/api/inverter/${profileId}/energy?${query(32 * 24)}`).expect(
        400,
      );
    });

    it("hides another user's energy", async () => {
      await get(
        `/api/inverter/${profileId}/energy?${query(24)}`,
        strangerToken,
      ).expect(404);
    });
  });
});
