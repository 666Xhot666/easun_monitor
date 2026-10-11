import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, registerUser, resetDatabase } from './helpers';

const DEFAULTS = {
  mode: 'FIRMWARE',
  minPercent: 0,
  manualPercent: 100,
  rules: [{ aboveC: 80, percent: 100 }],
};

describe('Server fan (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: string;
  let viewer: string;
  let stranger: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    owner = await registerUser(app, 'owner@example.com');
    viewer = await registerUser(app, 'viewer@example.com');
    stranger = await registerUser(app, 'stranger@example.com');
    await prisma.user.update({
      where: { email: 'viewer@example.com' },
      data: { serverViewer: true },
    });
  });
  beforeEach(async () => {
    await prisma.serverFanSettings.deleteMany();
    await prisma.serverSample.deleteMany();
  });
  afterAll(() => app.close());

  const as = (token: string) => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`),
    put: (path: string) =>
      request(app.getHttpServer())
        .put(path)
        .set('Authorization', `Bearer ${token}`),
    post: (path: string) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${token}`),
  });

  it('starts with the firmware in charge and one rule: above 80 °C, full speed', async () => {
    const { body } = await as(viewer).get('/api/server/fan').expect(200);
    expect(body).toEqual({ settings: DEFAULTS, state: null });
    await as(stranger).get('/api/server/fan').expect(403);
  });

  it('lets the owner change it, keeping the rules in order of temperature', async () => {
    const { body } = await as(owner)
      .put('/api/server/fan')
      .send({
        mode: 'AUTO',
        minPercent: 10,
        manualPercent: 60,
        rules: [
          { aboveC: 80, percent: 100 },
          { aboveC: 20, percent: 10 },
          { aboveC: 40, percent: 20 },
        ],
      })
      .expect(200);
    expect(body.rules).toEqual([
      { aboveC: 20, percent: 10 },
      { aboveC: 40, percent: 20 },
      { aboveC: 80, percent: 100 },
    ]);
    const { body: read } = await as(viewer).get('/api/server/fan').expect(200);
    expect(read.settings).toEqual(body);
  });

  it('is changed by the owner only, and only to sensible values', async () => {
    await as(viewer).put('/api/server/fan').send(DEFAULTS).expect(403);
    for (const wrong of [
      { ...DEFAULTS, mode: 'TURBO' },
      { ...DEFAULTS, minPercent: 101 },
      { ...DEFAULTS, manualPercent: 2.5 },
      { ...DEFAULTS, rules: [{ aboveC: 130, percent: 50 }] },
      { ...DEFAULTS, rules: [{ aboveC: 50, percent: -1 }] },
      {
        ...DEFAULTS,
        rules: [
          { aboveC: 50, percent: 10 },
          { aboveC: 50, percent: 20 },
        ],
      },
      {
        ...DEFAULTS,
        rules: Array.from({ length: 11 }, (_, i) => ({
          aboveC: i * 5,
          percent: i * 5,
        })),
      },
    ]) {
      await as(owner).put('/api/server/fan').send(wrong).expect(400);
    }
  });

  it('hands the settings to the agent with each report, and shows what it did', async () => {
    await as(owner)
      .put('/api/server/fan')
      .send({ ...DEFAULTS, mode: 'MANUAL', manualPercent: 30 })
      .expect(200);
    const { body: made } = await as(owner)
      .post('/api/server/agent/token')
      .expect(201);
    const state = {
      mode: 'manual',
      percent: 30,
      pwm: 128,
      steps: 3,
      error: null,
    };
    const { body } = await request(app.getHttpServer())
      .post('/api/server/agent/samples')
      .set('Authorization', `Bearer ${made.token}`)
      .send({
        at: new Date().toISOString(),
        uptimeSeconds: 1,
        cpu: { usagePercent: null, coresPercent: [], load: [0, 0, 0] },
        memory: {
          totalBytes: 1,
          availableBytes: 1,
          swapTotalBytes: 0,
          swapFreeBytes: 0,
        },
        disks: [],
        network: [],
        temperatures: [],
        fans: [],
        services: null,
        containers: null,
        fanControl: state,
      })
      .expect(202);
    expect(body).toEqual({
      stored: true,
      fan: { ...DEFAULTS, mode: 'MANUAL', manualPercent: 30 },
    });
    const { body: read } = await as(viewer).get('/api/server/fan').expect(200);
    expect(read.state).toEqual(state);
  });
});
