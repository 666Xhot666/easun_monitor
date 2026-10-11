import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import type { HostSample } from '../src/server-agent/sample';
import {
  AgentServerClient,
  ServerError,
} from '../src/server-agent/server-client';
import { createTestApp, registerUser, resetDatabase } from './helpers';

const sample = (at: Date, over: Partial<HostSample> = {}): HostSample => ({
  at: at.toISOString(),
  uptimeSeconds: 3600,
  cpu: { usagePercent: 12.5, coresPercent: [10, 15], load: [0.5, 0.4, 0.3] },
  memory: {
    totalBytes: 8e9,
    availableBytes: 3e9,
    swapTotalBytes: 2e9,
    swapFreeBytes: 2e9,
  },
  disks: [{ mount: '/', totalBytes: 2.5e11, freeBytes: 1e11 }],
  network: [{ name: 'eth0', rxBytesPerSecond: 1200, txBytesPerSecond: 300 }],
  temperatures: [{ device: 'coretemp', label: 'Package id 0', celsius: 61 }],
  fans: [{ device: 'fanchip', label: 'fan1', rpm: 2509 }],
  services: [{ name: 'easun-bms-reader', active: true }],
  containers: [{ name: 'eam_server', state: 'running', status: 'Up 3 hours' }],
  ...over,
});

describe('Server agent (e2e)', () => {
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
    await prisma.serverSample.deleteMany();
    await prisma.serverAgent.deleteMany();
  });
  afterAll(() => app.close());

  const as = (token: string) => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`),
    post: (path: string) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${token}`),
  });
  const newToken = async () =>
    (await as(owner).post('/api/server/agent/token').expect(201)).body
      .token as string;
  const report = (token: string, body: object) =>
    as(token).post('/api/server/agent/samples').send(body);

  it('stores what the agent reports and shows the latest to the owner and viewers', async () => {
    const token = await newToken();
    const at = new Date(Date.now() - 30_000);
    expect((await report(token, sample(at)).expect(202)).body).toMatchObject({
      stored: true,
    });

    for (const user of [owner, viewer]) {
      const { body } = await as(user).get('/api/server/status').expect(200);
      expect(body).toEqual({
        agent: { configured: true, lastSeenAt: expect.any(String) },
        sample: sample(at),
        stale: false,
      });
    }
    await as(stranger).get('/api/server/status').expect(403);
  });

  it('stores a re-sent sample once', async () => {
    const token = await newToken();
    const at = new Date();
    await report(token, sample(at)).expect(202);
    const { body } = await report(token, sample(at)).expect(202);
    expect(body).toMatchObject({ stored: false });
    expect(await prisma.serverSample.count()).toBe(1);
  });

  it('says when the agent has not reported for 3 minutes, or never', async () => {
    const { body: none } = await as(owner)
      .get('/api/server/status')
      .expect(200);
    expect(none).toEqual({
      agent: { configured: false, lastSeenAt: null },
      sample: null,
      stale: true,
    });

    const token = await newToken();
    await report(token, sample(new Date(Date.now() - 4 * 60_000))).expect(202);
    const { body } = await as(owner).get('/api/server/status').expect(200);
    expect(body.stale).toBe(true);
  });

  it('lets only the owner make the token; a new one replaces the old', async () => {
    await as(viewer).post('/api/server/agent/token').expect(403);
    const first = await newToken();
    const second = await newToken();
    await report(first, sample(new Date())).expect(401);
    await report(second, sample(new Date())).expect(202);
    await report('nope', sample(new Date())).expect(401);
  });

  it('refuses a sample in an unexpected form', async () => {
    const token = await newToken();
    const now = new Date();
    for (const wrong of [
      { ...sample(now), at: 'yesterday' },
      {
        ...sample(now),
        cpu: { usagePercent: 'high', coresPercent: [], load: [0, 0, 0] },
      },
      { ...sample(now), disks: [{ mount: '/', totalBytes: -1, freeBytes: 0 }] },
      { ...sample(now), temperatures: 'hot' },
      { ...sample(now), memory: undefined },
    ]) {
      await report(token, wrong).expect(400);
    }
    // Optional parts may be missing.
    await report(
      token,
      sample(now, { services: null, containers: null }),
    ).expect(202);
  });

  it("takes the agent's own client's reports", async () => {
    const url = await app.getUrl();
    const client = new AgentServerClient({ url, token: await newToken() });
    await client.postSample(sample(new Date()));
    expect(await prisma.serverSample.count()).toBe(1);

    const wrong = new AgentServerClient({ url, token: 'nope' });
    const error = await wrong.postSample(sample(new Date())).catch((e) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect(error.unauthorized).toBe(true);
  });
});
