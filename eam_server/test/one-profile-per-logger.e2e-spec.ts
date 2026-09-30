import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, registerUser, resetDatabase, sampleProfile } from './helpers';

describe('One inverter profile per logger address (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const setup = (token: string, body: object) =>
    request(app.getHttpServer())
      .post('/api/inverter/setup')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('refuses to pair a logger address that is already paired, by anyone', async () => {
    const first = await registerUser(app, 'first@example.com');
    const second = await registerUser(app, 'second@example.com');

    await setup(first, sampleProfile).expect(201);
    const res = await setup(second, { ...sampleProfile, name: 'Mine too' }).expect(409);
    expect(res.body.message).toMatch(/already paired/);

    // Same host on a different port is a different logger.
    await setup(second, { ...sampleProfile, port: 8900 }).expect(201);
  });

  it('refuses to move a profile onto an address that is already paired', async () => {
    const token = await registerUser(app, 'owner@example.com');
    await setup(token, sampleProfile).expect(201);
    const other = await setup(token, { ...sampleProfile, ipAddress: '192.168.1.51' }).expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/inverter/profiles/${other.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ipAddress: sampleProfile.ipAddress })
      .expect(409);
    expect(res.body.message).toMatch(/already paired/);
  });
});
