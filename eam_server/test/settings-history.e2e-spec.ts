import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { InMemoryLogger } from '../src/inverter/link/in-memory-logger';
import { LOGGER_TRANSPORT_FACTORY } from '../src/inverter/link/logger-links';
import { PollingService } from '../src/inverter/polling.service';
import { listenOnLoopback, registerUser, resetDatabase, sampleProfile } from './helpers';
import { InMemoryTransport } from './support/in-memory-transport';

describe('Settings history (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let logger: InMemoryLogger;
  let writes = 0;
  const transports: InMemoryTransport[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOGGER_TRANSPORT_FACTORY)
      .useValue((host: string) => {
        const transport = new InMemoryTransport(
          host === '192.168.1.50' ? logger : null,
        );
        transports.push(transport);
        return transport;
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await listenOnLoopback(app);
  });

  beforeEach(async () => {
    writes = 0;
    logger = new InMemoryLogger({
      isWritable: (a) => a >= 300 && a <= 420,
      onWrite: () => writes++,
    });
    logger.set(320, [2300]); // OutputVoltageSet 230.0 V
    logger.set(301, [2]); // OutputPriority SBU
    logger.set(643, [3200]); // RatedPower
    transports.length = 0;
    await resetDatabase(app);
    await app.get(PollingService).syncProfiles();
    token = await registerUser(app, 'owner@example.com');
  });

  afterAll(() => app.close());

  const pair = async (ipAddress = '192.168.1.50') =>
    (
      await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...sampleProfile, ipAddress })
        .expect(201)
    ).body.id as number;
  const call = (method: 'get' | 'post' | 'patch', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);
  const history = async (id: number, query = '') =>
    (await call('get', `/api/inverter/${id}/settings/history${query}`).expect(200)).body as {
      readAt: string;
      lastSeenAt: string;
      reason: string;
      changes: Record<string, number> | null;
      values: Record<string, number>;
    }[];

  it('keeps one snapshot per distinct settings state the inverter reports', async () => {
    const id = await pair();
    await call('post', `/api/inverter/${id}/settings/refresh`).expect(201);
    const first = await history(id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ reason: 'read', changes: null, values: { OutputVoltageSet: 230, OutputPriority: 2 } });

    await new Promise((r) => setTimeout(r, 20));
    await call('post', `/api/inverter/${id}/settings/refresh`).expect(201); // nothing changed
    const same = await history(id);
    expect(same).toHaveLength(1);
    expect(Date.parse(same[0].lastSeenAt)).toBeGreaterThan(Date.parse(first[0].lastSeenAt));

    logger.set(320, [2400]); // changed on the inverter's own panel
    await call('post', `/api/inverter/${id}/settings/refresh`).expect(201);
    const changed = await history(id);
    expect(changed.map((s) => s.values.OutputVoltageSet)).toEqual([240, 230]);
  });

  it('marks the snapshot read back after the app writes settings', async () => {
    const id = await pair();
    await call('patch', `/api/inverter/${id}/settings`).send({ changes: { OutputPriority: 0 } }).expect(200);
    const [latest] = await history(id);
    expect(latest).toMatchObject({ reason: 'write', changes: { OutputPriority: 0 }, values: { OutputPriority: 0 } });
  });

  it('returns only the requested time range', async () => {
    const id = await pair();
    await call('post', `/api/inverter/${id}/settings/refresh`).expect(201);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(await history(id, `?from=${future}`)).toEqual([]);
  });

  it("keeps other users' settings history private", async () => {
    const id = await pair();
    const other = await registerUser(app, 'other@example.com');
    await request(app.getHttpServer())
      .get(`/api/inverter/${id}/settings/history`)
      .set('Authorization', `Bearer ${other}`)
      .expect(404);
  });
});
