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

      const res = await call('get', `${base}?${range}&tz=Europe/Kyiv`).expect(
        200,
      );

      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="bms-.*\.csv"$/,
      );
      const lines = res.text.split('\r\n');
      expect(lines[0]).toMatch(
        /^\uFEFFTime \(Europe\/Kyiv\),State of charge \(%\),Pack voltage \(V\)/,
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
