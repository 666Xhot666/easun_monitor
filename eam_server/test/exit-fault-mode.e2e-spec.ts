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

describe('Exit fault mode (e2e)', () => {
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
      isWritable: (a) => a >= 300 && a <= 426,
      onWrite: () => writes++,
    });
    logger.set(320, [2300]); // OutputVoltageSet 230.0 V
    logger.set(301, [2]); // OutputPriority SBU
    logger.set(643, [3200]); // RatedPower
    logger.set(201, [6]); // OperationMode Fault
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

  it('clears the fault when the inverter is in fault mode', async () => {
    const id = await pair();
    await call('post', `/api/inverter/${id}/exit-fault-mode`).expect(201);
    expect(logger.get(426, 1)).toEqual([1]);
  });

  it('refuses when the inverter is not in fault mode, sending nothing', async () => {
    const id = await pair();
    logger.set(201, [3]); // Off-grid
    writes = 0;
    const res = await call('post', `/api/inverter/${id}/exit-fault-mode`).expect(409);
    expect(res.body.message).toMatch(/not in fault mode/);
    expect(writes).toBe(0);
  });

  it("can't clear another user's inverter", async () => {
    const id = await pair();
    const other = await registerUser(app, 'other@example.com');
    await request(app.getHttpServer())
      .post(`/api/inverter/${id}/exit-fault-mode`)
      .set('Authorization', `Bearer ${other}`)
      .expect(404);
    expect(writes).toBe(0);
  });
});
