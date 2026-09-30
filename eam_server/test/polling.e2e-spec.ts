import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { InMemoryLogger } from '../src/inverter/link/in-memory-logger';
import { LOGGER_TRANSPORT_FACTORY } from '../src/inverter/link/logger-links';
import { PollingService } from '../src/inverter/polling.service';
import { TransportError, type LoggerTransport } from '../src/inverter/link/logger-transport';
import { registerUser, resetDatabase, sampleProfile } from './helpers';

/** In-process adapter at the transport seam: frames go straight to an
 * in-memory logger, or fail as an unreachable logger would. */
class InMemoryTransport implements LoggerTransport {
  connected = false;
  constructor(private readonly logger: InMemoryLogger | null) {}
  async connect() {
    if (!this.logger) throw new TransportError('UDP handshake timed out');
    this.connected = true;
  }
  async exchange(frame: Buffer) {
    return this.logger!.handle(frame);
  }
  close() {
    this.connected = false;
  }
}

describe('Polling through the Logger link (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const logger = new InMemoryLogger({ isWritable: (a) => a >= 300 });
  logger.set(202, [2305]); // MainsVoltage 230.5 V
  logger.set(229, [87]); // BatterySoc 87 %
  logger.set(100, [0, 0]); // FaultCode

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOGGER_TRANSPORT_FACTORY)
      .useValue((host: string) => new InMemoryTransport(host === '192.168.1.50' ? logger : null))
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    // The poller started at boot against whatever the previous suite left;
    // resync so it tracks the now-empty table (ids restart from 1).
    await app.get(PollingService).syncProfiles();
    token = await registerUser(app, 'owner@example.com');
  });

  afterAll(() => app.close());

  const pair = (ipAddress: string) =>
    request(app.getHttpServer())
      .post('/api/inverter/setup')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...sampleProfile, ipAddress })
      .expect(201);

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  const eventually = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 50; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('condition not met in time');
  };

  it('polls a newly paired inverter at once and stores decoded telemetry', async () => {
    const { id } = (await pair('192.168.1.50')).body;

    await eventually(async () => (await get(`/api/inverter/${id}/latest`)).status === 200);
    const latest = await get(`/api/inverter/${id}/latest`);
    expect(latest.body.payload).toMatchObject({ MainsVoltage: 230.5, BatterySoc: 87, FaultCode: 0 });
    // Settings are not part of the fast telemetry cycle.
    expect(latest.body.payload).not.toHaveProperty('OutputVoltageSet');

    const status = await get(`/api/inverter/${id}/status`).expect(200);
    expect(status.body).toMatchObject({ state: 'online', lastError: null });
  });

  it('reports an unreachable logger instead of storing anything', async () => {
    const { id } = (await pair('192.168.1.99')).body;

    await eventually(async () => (await get(`/api/inverter/${id}/status`)).body.state === 'backoff');
    const status = await get(`/api/inverter/${id}/status`);
    expect(status.body.lastError).toMatch(/handshake timed out/);
    expect(status.body.retryAt).toEqual(expect.any(String));
    await get(`/api/inverter/${id}/latest`).expect(404);
  });

  it('verifies a logger before pairing with one round trip', async () => {
    const ok = await request(app.getHttpServer())
      .post('/api/inverter/pair/test')
      .set('Authorization', `Bearer ${token}`)
      .send({ ipAddress: '192.168.1.50', port: 8899 })
      .expect(201);
    expect(ok.body).toMatchObject({ success: true, sampledParameter: 'OperationMode' });

    const down = await request(app.getHttpServer())
      .post('/api/inverter/pair/test')
      .set('Authorization', `Bearer ${token}`)
      .send({ ipAddress: '192.168.1.99', port: 8899 })
      .expect(400);
    expect(down.body.message).toMatch(/handshake timed out/);
  });
});
