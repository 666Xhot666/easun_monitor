import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

describe('Location on the inverter profile (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let profileId: number;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
    profileId = (
      await call('post', '/api/inverter/setup').send(sampleProfile).expect(201)
    ).body.id;
  });

  afterAll(() => app.close());

  const call = (method: 'get' | 'post' | 'patch', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);

  it('stores the location rounded to about 10 km, and shows it with the profile', async () => {
    const { body } = await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ latitude: 12.3456, longitude: -45.678 })
      .expect(200);
    expect(body).toMatchObject({ latitude: 12.3, longitude: -45.7 });

    const me = await call('get', '/api/auth/me').expect(200);
    expect(me.body.inverterProfiles[0]).toMatchObject({
      latitude: 12.3,
      longitude: -45.7,
    });
  });

  it('clears the location with null', async () => {
    const { body } = await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ latitude: null, longitude: null })
      .expect(200);
    expect(body).toMatchObject({ latitude: null, longitude: null });
  });

  it('refuses a place that does not exist', async () => {
    for (const location of [
      { latitude: 90.1 },
      { latitude: -91 },
      { longitude: 180.5 },
      { longitude: -181 },
      { latitude: 'north' },
    ]) {
      await call('patch', `/api/inverter/profiles/${profileId}`)
        .send(location)
        .expect(400);
    }
  });
});
