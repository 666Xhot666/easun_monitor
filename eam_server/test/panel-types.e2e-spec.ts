import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, registerUser, resetDatabase } from './helpers';

const longi = {
  name: 'Longi Hi-MO 6 450W',
  maxPowerW: 450,
  vmpV: 41.5,
  impA: 10.85,
  vocV: 49.5,
  iscA: 11.5,
};

describe('Panel types (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let strangerToken: string;

  // Users are made once: registration is rate-limited.
  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
    strangerToken = await registerUser(app, 'stranger@example.com');
  });

  afterAll(() => app.close());

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    auth = token,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${auth}`);

  it("adds panel types to the user's own list", async () => {
    const created = await call('post', '/api/panel-types')
      .send(longi)
      .expect(201);
    expect(created.body).toMatchObject({ id: expect.any(Number), ...longi });

    await call('post', '/api/panel-types', strangerToken)
      .send({ ...longi, name: 'Theirs' })
      .expect(201);

    const { body } = await call('get', '/api/panel-types').expect(200);
    expect(body.map((t: { name: string }) => t.name)).toEqual([longi.name]);
  });

  it('refuses incomplete or impossible panel data', async () => {
    await call('post', '/api/panel-types')
      .send({ ...longi, name: '' })
      .expect(400);
    await call('post', '/api/panel-types')
      .send({ ...longi, maxPowerW: 0 })
      .expect(400);
    await call('post', '/api/panel-types')
      .send({ name: 'No numbers' })
      .expect(400);
    // Vmp above Voc or Imp above Isc can't be a real panel.
    await call('post', '/api/panel-types')
      .send({ ...longi, name: 'Bad V', vmpV: 60 })
      .expect(400);
    await call('post', '/api/panel-types')
      .send({ ...longi, name: 'Bad I', impA: 12 })
      .expect(400);
  });

  it('refuses a second panel type with the same name', async () => {
    await call('post', '/api/panel-types')
      .send({ ...longi, name: 'Twin' })
      .expect(201);
    await call('post', '/api/panel-types')
      .send({ ...longi, name: 'Twin' })
      .expect(409);
  });
});
