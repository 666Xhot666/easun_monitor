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

describe('Settings rules (e2e)', () => {
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
  const exchanges = () => transports.reduce((sum, t) => sum + t.exchanges, 0);

  it("serves the settings rules resolved for the installation's battery", async () => {
    const id = await pair();
    await call('get', `/api/inverter/${id}/settings`).expect(200);
    const before = exchanges();
    const res = await call('get', `/api/inverter/${id}/settings/constraints`).expect(200);
    expect(res.body.batteryVoltage).toBe(24);
    expect(res.body.bounds.MaxChargingVoltage).toMatchObject({ min: 24, max: 30 });
    expect(res.body.defaults.MaxChargingVoltage).toBe(28.2);
    expect(res.body.rules).toContainEqual(
      expect.objectContaining({ id: 'R-TYPE-2', setting: 'BatteryEqModeEnabled' }),
    );
    expect(exchanges()).toBe(before);
  });

  it('refuses changes that break a settings rule, writing nothing', async () => {
    const id = await pair();
    logger.set(324, [282]); // MaxChargingVoltage 28.2 V
    logger.set(325, [270]); // FloatingChargingVoltage 27.0 V
    await call('post', `/api/inverter/${id}/settings/refresh`).expect(201);

    const range = await call('patch', `/api/inverter/${id}/settings`)
      .send({ changes: { MaxChargingVoltage: 56.4 } })
      .expect(400);
    expect(range.body.message).toMatch(
      /Bulk charging voltage: Must be between 24 and 30 for a 24 V battery/,
    );

    const contradiction = await call('patch', `/api/inverter/${id}/settings`)
      .send({ changes: { MaxChargingVoltage: 26.5 } })
      .expect(400);
    expect(contradiction.body.errors.FloatingChargingVoltage).toEqual([
      'Bulk charging voltage must be at least the float charging voltage',
    ]);
    expect(writes).toBe(0);
  });

  it('writes a change with a warning only once the user acknowledges it', async () => {
    const id = await pair(); // a LiFePO4 installation
    const unacknowledged = await call('patch', `/api/inverter/${id}/settings`)
      .send({ changes: { BatteryEqModeEnabled: 1 } })
      .expect(400);
    expect(unacknowledged.body.warnings).toEqual({
      BatteryEqModeEnabled: ['Never equalize a lithium battery'],
    });
    expect(writes).toBe(0);

    await call('patch', `/api/inverter/${id}/settings`)
      .send({ changes: { BatteryEqModeEnabled: 1 }, acknowledgeWarnings: true })
      .expect(200);
    expect(logger.get(313, 1)).toEqual([1]);
  });

});
