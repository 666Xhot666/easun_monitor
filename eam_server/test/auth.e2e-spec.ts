

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, resetDatabase, registerUser, sampleProfile } from './helpers';

describe('Auth and ownership (e2e)', () => {
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

  describe('POST /api/auth/login', () => {
    it('accepts the correct password', async () => {
      await registerUser(app, 'a@example.com');

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'a@example.com',
          password: 'correct-horse-battery',
        })
        .expect(200);

      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.accessToken.length).toBeGreaterThan(0);

      const setCookie = (res.headers['set-cookie'] ?? []) as string[];
      expect(setCookie.some((cookie) => cookie.startsWith('refresh_token='))).toBe(true);
    });

    it('rejects a wrong password', async () => {
      await registerUser(app, 'a@example.com');

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'a@example.com',
          password: 'wrong-password-123',
        })
        .expect(401);

      expect(res.body.message).toBe('Invalid email or password');
    });

    it('rejects an unknown email with the same message', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'nobody@example.com',
          password: 'correct-horse-battery',
        })
        .expect(401);

      expect(res.body.message).toBe('Invalid email or password');
    });
  });

  describe('inverter ownership', () => {
    it('hides another user\'s profile, readings and history', async () => {
      const ownerToken = await registerUser(app, 'owner@example.com');
      const otherToken = await registerUser(app, 'other@example.com');

      const setupRes = await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(sampleProfile)
        .expect(201);

      const id = setupRes.body.id;

      await request(app.getHttpServer())
        .get(`/api/inverter/profiles/${id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/inverter/${id}/latest`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/inverter/${id}/history`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/api/inverter/profiles/${id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          name: 'x',
        })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/inverter/profiles/${id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/inverter/profiles/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });
});
