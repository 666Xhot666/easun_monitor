import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

const DAY = 24 * 3_600_000;
const iso = (at: number) => new Date(at).toISOString().slice(0, 10);

describe('Solar forecast (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let strangerToken: string;
  let profileId: number;
  const today = iso(Date.now());
  const yesterday = iso(Date.now() - DAY);
  const tomorrow = iso(Date.now() + DAY);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
    strangerToken = await registerUser(app, 'stranger@example.com');
    profileId = (
      await call('post', '/api/inverter/setup').send(sampleProfile).expect(201)
    ).body.id;
    const panel = await call('post', '/api/panel-types')
      .send({
        name: 'Panel 450W',
        maxPowerW: 450,
        vmpV: 41.5,
        impA: 10.85,
        vocV: 49.5,
        iscA: 11.5,
      })
      .expect(201);
    await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({
        pvPanelTypeId: panel.body.id,
        pvPanelsInSeries: 3,
        pvStrings: 2,
      })
      .expect(200);
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  const call = (method: 'get' | 'post' | 'patch', path: string, auth = token) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${auth}`);

  /** Open-Meteo's answer: full sun (1000 W/m², cells at 25 °C) at noon each day. */
  const weather = () => {
    const days = [yesterday, today, tomorrow];
    const time = days.flatMap((d) => [`${d}T06:00`, `${d}T12:00`]);
    return jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            hourly: {
              time,
              global_tilted_irradiance: days.flatMap(() => [0, 1000]),
              cloud_cover: days.flatMap(() => [90, 10]),
              temperature_2m: days.flatMap(() => [5, 25 - 1000 * (25 / 800)]),
            },
          }),
        ),
      ),
    );
  };

  it('asks for the location before it can forecast', async () => {
    const { body } = await call(
      'get',
      `/api/inverter/${profileId}/solar-forecast`,
    ).expect(409);
    expect(body.message).toMatch(/location/i);
  });

  it("gives each day's expected PV against what the array made, and tomorrow's hours", async () => {
    await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ latitude: 12.3, longitude: -45.7 })
      .expect(200);
    // Yesterday: one hour at 1080 W.
    const start = new Date(`${yesterday}T11:00:00Z`).getTime();
    await prisma.inverterLog.createMany({
      data: Array.from({ length: 721 }, (_, i) => ({
        inverterProfileId: profileId,
        timestamp: new Date(start + i * 5_000),
        payload: { PVPower: 1080 },
      })),
    });
    const fetch = weather();

    const { body } = await call(
      'get',
      `/api/inverter/${profileId}/solar-forecast`,
    ).expect(200);

    // 2700 W of panels at full sun: 2160 W for an hour.
    expect(body.days).toEqual([
      { date: yesterday, expectedKWh: 2.16, actualKWh: 1.08, cloudCover: 10 },
      { date: today, expectedKWh: 2.16, actualKWh: null, cloudCover: 10 },
      { date: tomorrow, expectedKWh: 2.16, actualKWh: null, cloudCover: 10 },
    ]);
    expect(body.hours).toEqual([
      { time: `${today}T06:00`, expectedW: 0, cloudCover: 90 },
      { time: `${today}T12:00`, expectedW: 2160, cloudCover: 10 },
      { time: `${tomorrow}T06:00`, expectedW: 0, cloudCover: 90 },
      { time: `${tomorrow}T12:00`, expectedW: 2160, cloudCover: 10 },
    ]);
    expect(body.assumedMounting).toBe(true);

    // Asked again within the hour: from the cache.
    await call('get', `/api/inverter/${profileId}/solar-forecast`).expect(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('says when the weather is not available', async () => {
    // A new mounting is not in the cache, so the weather is asked for.
    await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ pvTiltDeg: 20 })
      .expect(200);
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));

    const { body } = await call(
      'get',
      `/api/inverter/${profileId}/solar-forecast`,
    ).expect(503);
    expect(body.message).toMatch(/not available/);
  });

  it("does not show a stranger another household's forecast", async () => {
    await call(
      'get',
      `/api/inverter/${profileId}/solar-forecast`,
      strangerToken,
    ).expect(404);
  });
});
