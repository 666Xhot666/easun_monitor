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

describe('Device info (e2e)', () => {
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
    await app.init();
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
    // "9233240510217 0" packed two characters per word, NUL padded to 12 words.
    logger.set(186, [0x3932, 0x3333, 0x3234, 0x3035, 0x3130, 0x3231, 0x3720, 0x3000, 0, 0, 0, 0]);
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


  it("reads the inverter's serial number", async () => {
    const id = await pair();
    const res = await call('get', `/api/inverter/${id}/device-info`).expect(200);
    expect(res.body).toEqual({ SerialNumber: '9233240510217 0' });
  });

  it("can't read another user's inverter", async () => {
    const id = await pair();
    const other = await registerUser(app, 'other@example.com');
    await request(app.getHttpServer())
      .get(`/api/inverter/${id}/device-info`)
      .set('Authorization', `Bearer ${other}`)
      .expect(404);
  });
});
