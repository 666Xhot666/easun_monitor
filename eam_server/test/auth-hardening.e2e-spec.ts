import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, registerUser, resetDatabase } from './helpers';

const withEnv = async <T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
) => {
  const previous = Object.fromEntries(
    Object.keys(vars).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars))
    if (v === undefined) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

const refreshCookie = (res: request.Response) =>
  ((res.headers['set-cookie'] ?? []) as unknown as string[])
    .find((c) => c.startsWith('refresh_token='))!
    .split(';')[0];

describe('Auth hardening (e2e)', () => {
  describe('with the default configuration', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await withEnv(
        { ALLOW_REGISTRATION: undefined, JWT_EXPIRES_IN: undefined },
        () => createTestApp(),
      );
    });
    beforeEach(() => resetDatabase(app));
    afterAll(() => app.close());

    it('sends security headers', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/me');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
    });

    it('lets the first account register, then closes registration', async () => {
      await registerUser(app, 'first@example.com');
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'second@example.com',
          password: 'correct-horse-battery',
        })
        .expect(403);
      expect(res.body.message).toMatch(/Registration is closed/);
    });

    it('issues access tokens that live 15 minutes', async () => {
      const token = await registerUser(app, 'first@example.com');
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      );
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('signs a user out on every device', async () => {
      const token = await registerUser(app, 'first@example.com');
      const login = () =>
        request(app.getHttpServer())
          .post('/api/auth/login')
          .send({
            email: 'first@example.com',
            password: 'correct-horse-battery',
          })
          .expect(200);
      const laptop = refreshCookie(await login());
      const phone = refreshCookie(await login());

      await request(app.getHttpServer())
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      for (const cookie of [laptop, phone]) {
        await request(app.getHttpServer())
          .post('/api/auth/refresh')
          .set('Cookie', cookie)
          .expect(401);
      }
    });
  });

  it('rate-limits login attempts to 10 a minute', async () => {
    // Own app instance: the limiter's counters live in the app, so earlier
    // tests' logins must not count against this budget.
    const app = await createTestApp();
    try {
      await resetDatabase(app);
      await registerUser(app, 'first@example.com');
      const attempt = () =>
        request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: 'first@example.com', password: 'wrong-password-123' });

      for (let i = 0; i < 10; i++) {
        expect((await attempt()).status).toBe(401);
      }
      expect((await attempt()).status).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('keeps registration open when ALLOW_REGISTRATION=true', async () => {
    const app = await withEnv({ ALLOW_REGISTRATION: 'true' }, () =>
      createTestApp(),
    );
    try {
      await resetDatabase(app);
      await registerUser(app, 'first@example.com');
      await registerUser(app, 'second@example.com');
    } finally {
      await app.close();
    }
  });
});
