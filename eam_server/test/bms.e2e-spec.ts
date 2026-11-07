import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHash } from 'node:crypto';
import { decodeCellInfo } from '../src/bms/jk/cell-info';
import { decodeSettings } from '../src/bms/jk/settings';
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
      expect(statuses.slice(0, 120)).toEqual(Array(120).fill(202));
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

    it("lists a day's stored readings, newest first, a page at a time", async () => {
      const { device } = await addDevice();
      const at = (iso: string) => new Date(iso);
      await prisma.bmsLog.createMany({
        data: ['08:00', '08:01', '08:02'].map((hm, i) => ({
          bmsDeviceId: device.id,
          timestamp: at(`2026-10-01T${hm}:00Z`),
          payload: { stateOfChargePct: 70 + i },
        })),
      });
      const range = {
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-02T00:00:00Z',
      };

      const page = await call('get', `${base(device.id)}/readings`)
        .query({ ...range, limit: 2 })
        .expect(200);
      expect(page.body.map((r: { timestamp: string }) => r.timestamp)).toEqual([
        '2026-10-01T08:02:00.000Z',
        '2026-10-01T08:01:00.000Z',
      ]);
      expect(page.body[0].reading).toEqual({ stateOfChargePct: 72 });

      const next = await call('get', `${base(device.id)}/readings`)
        .query({ ...range, limit: 2, before: page.body[1].timestamp })
        .expect(200);
      expect(
        next.body.map(
          (r: { reading: { stateOfChargePct: number } }) =>
            r.reading.stateOfChargePct,
        ),
      ).toEqual([70]);

      await call('get', `${base(device.id)}/readings`, strangerToken)
        .query(range)
        .expect(404);
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

  describe('how the inverter reads the battery voltage', () => {
    const wiringPath = (bmsId: number, days = 30) =>
      `/api/inverter/profiles/${profileId}/bms/${bmsId}/wiring?days=${days}`;

    /** BMS and inverter logs a second apart: the inverter reads 0.23 V low behind 12.5 mΩ. */
    const seed = async (bmsId: number, start: Date, currents: number[]) => {
      await prisma.inverterLog.deleteMany();
      for (const [i, currentA] of currents.entries()) {
        const at = new Date(start.getTime() + i * 60_000);
        const batteryV = 26;
        await prisma.bmsLog.create({
          data: {
            bmsDeviceId: bmsId,
            timestamp: at,
            payload: { packVoltageV: batteryV, currentA },
          },
        });
        await prisma.inverterLog.create({
          data: {
            inverterProfileId: profileId,
            timestamp: new Date(at.getTime() + 1_000),
            payload: {
              BatteryVoltage:
                Math.round((batteryV - 0.23 + 0.0125 * currentA) * 100) / 100,
              BatteryCurrentSigned: currentA,
            },
          },
        });
      }
    };

    it('gives the path resistance and the offset, over the range and per week', async () => {
      const { device } = await addDevice();
      await seed(
        device.id,
        new Date(Date.now() - 3 * 86_400_000),
        [-76, -45, -14, -6, 5, 23, 42],
      );

      const { body } = await call('get', wiringPath(device.id)).expect(200);
      expect(body.overall).toMatchObject({ samples: 7 });
      expect(body.overall.resistanceOhm).toBeCloseTo(0.0125, 3);
      expect(body.overall.offsetV).toBeCloseTo(-0.23, 2);
      expect(body.weeks).toHaveLength(1);
      expect(body.weeks[0].fit.samples).toBe(7);
    });

    it('has no fit until the currents spread enough, and checks the range', async () => {
      const { device } = await addDevice();
      await seed(device.id, new Date(Date.now() - 86_400_000), [-6, -4, 3]);
      const { body } = await call('get', wiringPath(device.id)).expect(200);
      expect(body).toEqual({ overall: null, weeks: [] });
      await call('get', wiringPath(device.id, 400)).expect(400);
      await call('get', wiringPath(device.id), strangerToken).expect(404);
    });
  });

  describe("the BMS's settings", () => {
    /** What the reader posts: the decoded real settings frame. */
    const settingsReport = (at: Date, overrides: object = {}) => ({
      timestamp: at.toISOString(),
      protocol: 'JK02_32S',
      decoderVersion: 'jk-ble/2',
      settings: decodeSettings(
        referenceFrame('SETTINGS_REAL_PB2A16S20P_19U'),
        'JK02_32S',
      ),
      ...overrides,
    });
    const postSettings = (deviceToken: string | null, body: unknown) => {
      const req = request(app.getHttpServer()).post('/api/bms/ingest/settings');
      return (
        deviceToken === null
          ? req
          : req.set('Authorization', `Bearer ${deviceToken}`)
      ).send(body as object);
    };
    const settingsPath = (bmsId: number) =>
      `/api/inverter/profiles/${profileId}/bms/${bmsId}/settings`;

    it('are 404 until the reader has sent them', async () => {
      const { device } = await addDevice();
      await call('get', settingsPath(device.id)).expect(404);
    });

    it('takes them from the device token and shows them read-only', async () => {
      const { device, token: deviceToken } = await addDevice();
      const at = new Date(Date.now() - 5_000);
      await postSettings(null, settingsReport(at)).expect(401);
      await postSettings(deviceToken, settingsReport(at)).expect(202);

      const { body } = await call('get', settingsPath(device.id)).expect(200);
      expect(body).toMatchObject({
        receivedAt: at.toISOString(),
        protocol: 'JK02_32S',
        settings: {
          cellOvervoltageProtectionV: 3.6,
          cellChargeV: 3.45,
          maxChargeCurrentA: 48,
          chargeUndertemperatureC: 2,
          balancerEnabled: true,
          nominalCapacityAh: 102,
        },
      });
      await call('get', settingsPath(device.id), strangerToken).expect(404);
    });

    it('keeps the newest when an older report arrives late', async () => {
      const { device, token: deviceToken } = await addDevice();
      const newer = new Date(Date.now() - 1_000);
      const older = new Date(Date.now() - 60_000);
      await postSettings(
        deviceToken,
        settingsReport(newer, {
          settings: { maxChargeCurrentA: 40, chargeEnabled: true },
        }),
      ).expect(202);
      await postSettings(
        deviceToken,
        settingsReport(older, { settings: { maxChargeCurrentA: 30 } }),
      ).expect(202);
      const { body } = await call('get', settingsPath(device.id)).expect(200);
      expect(body.settings).toEqual({
        maxChargeCurrentA: 40,
        chargeEnabled: true,
      });
    });

    it('rejects settings that are not flat numbers and switches', async () => {
      const { token: deviceToken } = await addDevice();
      const at = new Date();
      for (const settings of [
        { nested: { a: 1 } },
        { name: 'text' },
        { 'bad key': 1 },
        Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i])),
        [],
      ]) {
        await postSettings(
          deviceToken,
          settingsReport(at, { settings }),
        ).expect(400);
      }
      await postSettings(
        deviceToken,
        settingsReport(new Date(Date.now() + 120_000)),
      ).expect(400);
    });
  });

  describe('managing a device', () => {
    const base = (bmsId: number) =>
      `/api/inverter/profiles/${profileId}/bms/${bmsId}`;

    it('replaces a lost token: the new one works, the old one stops', async () => {
      const { device, token: oldToken } = await addDevice();

      const { body } = await call('post', `${base(device.id)}/token`).expect(
        201,
      );

      expect(body.token).not.toBe(oldToken);
      await ingest(oldToken, reading(new Date(Date.now() - 1000))).expect(401);
      await ingest(body.token, reading(new Date(Date.now() - 1000))).expect(
        202,
      );
      await call('post', `${base(device.id)}/token`, strangerToken).expect(404);
    });

    it('removes a device with its readings', async () => {
      const { device, token: deviceToken } = await addDevice();
      await ingest(deviceToken, reading(new Date(Date.now() - 1000))).expect(
        202,
      );

      await call('delete', base(device.id), strangerToken).expect(404);
      await call('delete', base(device.id)).expect(200);

      expect(
        await prisma.bmsLog.count({ where: { bmsDeviceId: device.id } }),
      ).toBe(0);
      await ingest(deviceToken, reading(new Date())).expect(401);
    });
  });

  describe('using the BMS in the energy flow', () => {
    it('is off for a new device and can be switched on by its owner only', async () => {
      const { device } = await addDevice();
      const base = `/api/inverter/profiles/${profileId}/bms/${device.id}`;
      const list = async () =>
        (
          await call('get', `/api/inverter/profiles/${profileId}/bms`).expect(
            200,
          )
        ).body;

      expect((await list())[0]).toMatchObject({ useForEnergyFlow: false });

      const { body } = await call('patch', base)
        .send({ useForEnergyFlow: true })
        .expect(200);
      expect(body).toMatchObject({ id: device.id, useForEnergyFlow: true });
      expect(body).not.toHaveProperty('tokenHash');
      expect((await list())[0]).toMatchObject({ useForEnergyFlow: true });

      await call('patch', base).send({ useForEnergyFlow: 'yes' }).expect(400);
      await call('patch', base).send({ tokenHash: 'x' }).expect(400);
      await call('patch', base, strangerToken)
        .send({ useForEnergyFlow: false })
        .expect(404);
    });
  });

  describe('exporting readings', () => {
    it('downloads the stored readings of a range as CSV, oldest first, in the given time zone', async () => {
      const { device } = await addDevice();
      const t0 = new Date('2026-10-06T10:00:00Z').getTime();
      await prisma.bmsLog.createMany({
        data: Array.from({ length: 2500 }, (_, i) => ({
          bmsDeviceId: device.id,
          timestamp: new Date(t0 + i * 30_000),
          payload: {
            ...reading(new Date(t0 + i * 30_000)),
            stateOfChargePct: i % 100,
          } as object,
        })),
      });
      const base = `/api/inverter/profiles/${profileId}/bms/${device.id}/export`;
      const range = `from=${new Date(t0).toISOString()}&to=${new Date(t0 + 2500 * 30_000).toISOString()}`;

      const res = await call(
        'get',
        `${base}?${range}&tz=Europe/Helsinki`,
      ).expect(200);

      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="bms-.*\.csv"$/,
      );
      const lines = res.text.split('\r\n');
      expect(lines[0]).toMatch(
        /^\uFEFFTime \(Europe\/Helsinki\),State of charge \(%\),Pack voltage \(V\)/,
      );
      expect(lines[0]).toContain('Cell 16 (V)');
      expect(lines[1].startsWith('2026-10-06 13:00:00,0,54.028,')).toBe(true);
      expect(lines[2].startsWith('2026-10-06 13:00:30,1,')).toBe(true);
      expect(lines).toHaveLength(2502);
    });

    it('refuses bad ranges and time zones, and other users', async () => {
      const { device } = await addDevice();
      const base = `/api/inverter/profiles/${profileId}/bms/${device.id}/export`;
      const day = `from=2026-10-06T00:00:00.000Z&to=2026-10-07T00:00:00.000Z`;
      await call('get', `${base}?${day}&tz=Mars/Olympus`).expect(400);
      await call(
        'get',
        `${base}?from=2026-09-01T00:00:00.000Z&to=2026-10-07T00:00:00.000Z`,
      ).expect(400);
      await call('get', `${base}?${day}`, strangerToken).expect(404);
    });

    it('exports just the header row when nothing is stored', async () => {
      const { device } = await addDevice();
      const res = await call(
        'get',
        `/api/inverter/profiles/${profileId}/bms/${device.id}/export?from=2026-10-06T00:00:00.000Z&to=2026-10-07T00:00:00.000Z`,
      ).expect(200);
      expect(res.text.split('\r\n')).toEqual([
        '\uFEFFTime (UTC),State of charge (%),Pack voltage (V),Current (A),Power (W),Remaining capacity (Ah),Nominal capacity (Ah),Cycles,Lowest cell (V),Highest cell (V),Cell spread (mV),Lowest cell no.,Highest cell no.,Balancing,Balance current (A),Charge MOSFET,Discharge MOSFET,Alarms',
        '',
      ]);
    });
  });
});
