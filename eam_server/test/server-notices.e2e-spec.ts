import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import type { HostSample } from '../src/server-agent/sample';
import { ServerAlertsService } from '../src/server-monitor/server-alerts.service';
import { TELEGRAM_CLIENT } from '../src/telegram/telegram-client';
import { FakeTelegram } from './support/fake-telegram';
import { createTestApp, registerUser, resetDatabase } from './helpers';

const sample = (at: Date, celsius = 60): HostSample => ({
  at: at.toISOString(),
  uptimeSeconds: 1,
  cpu: { usagePercent: 5, coresPercent: [], load: [0, 0, 0] },
  memory: {
    totalBytes: 8e9,
    availableBytes: 4e9,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
  },
  disks: [{ mount: '/', totalBytes: 200e9, freeBytes: 100e9 }],
  network: [],
  temperatures: [{ device: 'coretemp', label: 'Package id 0', celsius }],
  fans: [],
  services: null,
  containers: null,
});

describe('Server notices (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let telegram: FakeTelegram;
  let owner: string;
  let viewer: string;
  let agentToken: string;
  let clock = Date.parse('2026-10-11T10:00:00Z');

  beforeAll(async () => {
    telegram = new FakeTelegram();
    app = await createTestApp((builder) =>
      builder.overrideProvider(TELEGRAM_CLIENT).useValue(telegram),
    );
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    owner = await registerUser(app, 'owner@example.com');
    viewer = await registerUser(app, 'viewer@example.com');
    await registerUser(app, 'stranger@example.com');
    const ids = Object.fromEntries(
      (await prisma.user.findMany()).map((u) => [u.email, u.id]),
    );
    await prisma.user.update({
      where: { id: ids['viewer@example.com'] },
      data: { serverViewer: true },
    });
    await prisma.telegramLink.createMany({
      data: [
        { chatId: '1', userId: ids['owner@example.com'] },
        { chatId: '2', userId: ids['viewer@example.com'] },
        { chatId: '3', userId: ids['stranger@example.com'] },
      ],
    });
    agentToken = (
      await request(app.getHttpServer())
        .post('/api/server/agent/token')
        .set('Authorization', `Bearer ${owner}`)
        .expect(201)
    ).body.token;
  });
  beforeEach(() => (telegram.sent = []));
  afterAll(() => app.close());

  const report = (celsius: number) => {
    clock += 60_000;
    return request(app.getHttpServer())
      .post('/api/server/agent/samples')
      .set('Authorization', `Bearer ${agentToken}`)
      .send(sample(new Date(clock), celsius))
      .expect(202);
  };
  const as = (token: string) => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`),
    put: (path: string) =>
      request(app.getHttpServer())
        .put(path)
        .set('Authorization', `Bearer ${token}`),
  });

  it('tells the owner and viewers when the server overheats, and keeps it for the Server page', async () => {
    await report(60); // the baseline
    await report(92);
    await report(93);
    const text = 'Server: overheating, 93 °C (Package id 0)';
    expect(telegram.sent).toEqual([
      { chatId: '1', text },
      { chatId: '2', text },
    ]);
    const { body } = await as(viewer).get('/api/server/alerts').expect(200);
    expect(body.events).toEqual([
      {
        id: expect.any(Number),
        kind: 'server-heat',
        text,
        at: expect.any(String),
      },
    ]);
    await report(60);
    expect(telegram.sent.map((m) => m.text)[2]).toBe(
      'Server: temperature back to 60 °C',
    );
  });

  it('follows the limits the owner sets', async () => {
    const { body } = await as(viewer).get('/api/server/alerts').expect(200);
    expect(body.limits).toEqual({
      heatC: 90,
      storageFreePercent: 10,
      memoryUsedPercent: 90,
    });

    await as(viewer)
      .put('/api/server/alerts/limits')
      .send(body.limits)
      .expect(403);
    await as(owner)
      .put('/api/server/alerts/limits')
      .send({ heatC: 70, storageFreePercent: 10, memoryUsedPercent: 90 })
      .expect(200);
    await report(72);
    await report(73);
    expect(telegram.sent.map((m) => m.chatId)).toEqual(['1', '2']);

    for (const wrong of [
      { heatC: 20, storageFreePercent: 10, memoryUsedPercent: 90 },
      { heatC: 90, storageFreePercent: 0, memoryUsedPercent: 90 },
      { heatC: 90, storageFreePercent: 10, memoryUsedPercent: 100 },
      { heatC: 90.5, storageFreePercent: 10, memoryUsedPercent: 90 },
    ]) {
      await as(owner).put('/api/server/alerts/limits').send(wrong).expect(400);
    }
    await as(owner)
      .put('/api/server/alerts/limits')
      .send({ heatC: 90, storageFreePercent: 10, memoryUsedPercent: 90 })
      .expect(200);
    await report(60);
    telegram.sent = [];
  });

  it('says when the agent goes silent for 5 minutes, and when it is back', async () => {
    const alerts = app.get(ServerAlertsService);
    await report(60);
    await alerts.checkSilent(new Date(clock + 4 * 60_000));
    expect(telegram.sent).toEqual([]);
    await alerts.checkSilent(new Date(clock + 5 * 60_000));
    await alerts.checkSilent(new Date(clock + 6 * 60_000));
    expect(telegram.sent.map((m) => m.text)).toEqual([
      'Server: agent silent since 10:08',
      'Server: agent silent since 10:08',
    ]);
    clock += 11 * 60_000;
    await report(60);
    expect(telegram.sent.map((m) => m.text)[2]).toBe(
      'Server: agent back after 12 min',
    );
  });

  it('sends nothing to those who turned the kind off', async () => {
    await as(viewer)
      .put('/api/notifications/settings')
      .send({ channels: { 'server-heat': { telegram: false } } })
      .expect(200);
    await report(95);
    await report(95);
    expect(telegram.sent.map((m) => m.chatId)).toEqual(['1']);
    await report(60);
  });

  it('is for the owner and viewers only', async () => {
    const stranger = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'stranger@example.com',
          password: 'correct-horse-battery',
        })
        .expect(200)
    ).body.accessToken;
    await as(stranger).get('/api/server/alerts').expect(403);
  });
});
