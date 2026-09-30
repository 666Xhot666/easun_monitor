import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { InMemoryLogger } from '../src/inverter/link/in-memory-logger';
import { LOGGER_TRANSPORT_FACTORY } from '../src/inverter/link/logger-links';
import { PollingService } from '../src/inverter/polling.service';
import { registerUser, resetDatabase, sampleProfile } from './helpers';
import { InMemoryTransport } from './support/in-memory-transport';

describe('Inverter settings (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let logger: InMemoryLogger;
  const transports: InMemoryTransport[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOGGER_TRANSPORT_FACTORY)
      .useValue((host: string) => {
        const transport = new InMemoryTransport(host === '192.168.1.50' ? logger : null);
        transports.push(transport);
        return transport;
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    logger = new InMemoryLogger({ isWritable: (a) => a >= 300 && a <= 420 });
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
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  const exchanges = () => transports.reduce((sum, t) => sum + t.exchanges, 0);

  it('reads the settings from the inverter', async () => {
    const id = await pair();
    const res = await call('get', `/api/inverter/${id}/settings`).expect(200);
    expect(res.body.values).toMatchObject({ OutputVoltageSet: 230, OutputPriority: 2, RatedPower: 3200 });
    expect(res.body.values).not.toHaveProperty('MainsVoltage');
    expect(Date.parse(res.body.readAt)).not.toBeNaN();
  });

  it('serves recent settings from cache and re-reads on demand', async () => {
    const id = await pair();
    const first = await call('get', `/api/inverter/${id}/settings`).expect(200);
    const before = exchanges();

    const cached = await call('get', `/api/inverter/${id}/settings`).expect(200);
    expect(cached.body.readAt).toBe(first.body.readAt);
    expect(exchanges()).toBe(before);

    logger.set(320, [2250]); // changed on the inverter's own panel
    const refreshed = await call('post', `/api/inverter/${id}/settings/refresh`).expect(201);
    expect(refreshed.body.values.OutputVoltageSet).toBe(225);
    expect(exchanges()).toBeGreaterThan(before);
  });

  it('writes a setting and returns the value confirmed by the inverter', async () => {
    const id = await pair();
    const res = await call('patch', `/api/inverter/${id}/settings`)
      .send({ changes: { OutputVoltageSet: 220.5, OutputPriority: 0 } })
      .expect(200);

    expect(res.body.values).toMatchObject({ OutputVoltageSet: 220.5, OutputPriority: 0 });
    expect(logger.get(320, 1)).toEqual([2205]);
    expect(logger.get(301, 1)).toEqual([0]);
  });

  it('rejects invalid values before writing anything', async () => {
    const id = await pair();
    const before = exchanges();
    const bad = await call('patch', `/api/inverter/${id}/settings`)
      .send({ changes: { OutputPriority: 5 } })
      .expect(400);
    expect(bad.body.message).toMatch(/not a valid option/);
    await call('patch', `/api/inverter/${id}/settings`).send({ changes: { RatedPower: 5000 } }).expect(400);
    await call('patch', `/api/inverter/${id}/settings`).send({ changes: {} }).expect(400);
    expect(exchanges()).toBe(before);
  });

  it('reports a value the inverter refuses', async () => {
    const id = await pair();
    logger.rejectWritesAt(301, 7);
    const res = await call('patch', `/api/inverter/${id}/settings`)
      .send({ changes: { OutputPriority: 1 } })
      .expect(409);
    expect(res.body.message).toMatch(/not allowed to be modified in the current working mode/);
  });

  it('says so when the inverter cannot be reached', async () => {
    const id = await pair('192.168.1.99');
    const res = await call('get', `/api/inverter/${id}/settings`).expect(503);
    expect(res.body.message).toMatch(/unreachable/);
  });

  it("keeps other users' inverter settings private", async () => {
    const id = await pair();
    const other = await registerUser(app, 'other@example.com');
    await request(app.getHttpServer())
      .get(`/api/inverter/${id}/settings`)
      .set('Authorization', `Bearer ${other}`)
      .expect(404);
  });
});
