import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { LoggerLinks } from '../src/inverter/link/logger-links';
import { createTestApp, registerUser, resetDatabase, sampleProfile } from './helpers';

describe('Logger address checks (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const probe = jest.fn();

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(LoggerLinks).useValue({ probe }),
    );
  });

  beforeEach(async () => {
    await resetDatabase(app);
    probe.mockReset();
    probe.mockResolvedValue({ latencyMs: 5, sampledRegister: 'X' });
    token = await registerUser(app, 'owner@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('verifies the logger at the port the user entered', async () => {
    await request(app.getHttpServer())
      .post('/api/inverter/pair/test')
      .set(auth())
      .send({ ipAddress: '192.168.1.50', port: 9000 })
      .expect(201);
    expect(probe).toHaveBeenCalledWith('192.168.1.50', 9000);
  });

  it('refuses to probe a public address', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inverter/pair/test')
      .set(auth())
      .send({ ipAddress: '8.8.8.8', port: 8899 })
      .expect(400);
    expect(res.body.message).toMatch(/private network/);
    expect(probe).not.toHaveBeenCalled();
  });

  it('refuses to pair or move a profile to a public address', async () => {
    await request(app.getHttpServer())
      .post('/api/inverter/setup')
      .set(auth())
      .send({ ...sampleProfile, ipAddress: '8.8.8.8' })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/api/inverter/setup')
      .set(auth())
      .send(sampleProfile)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/inverter/profiles/${created.body.id}`)
      .set(auth())
      .send({ ipAddress: '8.8.4.4' })
      .expect(400);
  });
});
