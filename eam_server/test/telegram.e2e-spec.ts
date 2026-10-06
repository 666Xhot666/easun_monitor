import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, registerUser, resetDatabase } from './helpers';

describe('Telegram (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  // Few users per file: registration is rate-limited.
  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
  });

  afterAll(() => app.close());

  const as = (method: 'get' | 'post' | 'delete', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);

  describe('linking a chat', () => {
    it('gives a short-lived one-time code to send to the bot', async () => {
      const { body } = await as('post', '/api/telegram/link-code').expect(201);

      expect(body.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(
        9 * 60_000,
      );
      expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(
        10 * 60_000,
      );
    });

    it('reports whether a chat is linked', async () => {
      const { body } = await as('get', '/api/telegram/link').expect(200);
      expect(body).toEqual({ linked: false });
    });

    it('needs a signed-in user', async () => {
      await request(app.getHttpServer())
        .post('/api/telegram/link-code')
        .expect(401);
    });
  });
});
