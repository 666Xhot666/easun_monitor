import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, registerUser, resetDatabase } from './helpers';

/** Runs `fn` with env vars set (undefined = unset), restoring them after. */
const withEnv = async <T>(vars: Record<string, string | undefined>, fn: () => Promise<T>) => {
  const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

describe('Dev-mode auto-login (e2e)', () => {
  let app: INestApplication<App>;
  const devLogin = () => request(app.getHttpServer()).get('/api/auth/dev-login');

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await registerUser(app, 'owner@example.com');
  });

  afterAll(() => app.close());

  it('signs in as the configured account in development, with a refresh cookie', async () => {
    const res = await withEnv(
      { NODE_ENV: 'development', DEV_AUTO_LOGIN: 'true', DEV_AUTO_LOGIN_EMAIL: 'owner@example.com' },
      () => devLogin().expect(200),
    );
    expect(res.body.user.email).toBe('owner@example.com');
    expect(String(res.headers['set-cookie'])).toMatch(/refresh_token=.*HttpOnly/);

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
  });

  it('does not exist unless opted in', async () => {
    await withEnv({ NODE_ENV: 'development', DEV_AUTO_LOGIN: undefined, DEV_AUTO_LOGIN_EMAIL: 'owner@example.com' }, () =>
      devLogin().expect(404),
    );
  });

  it('does not exist in production, even when opted in', async () => {
    const res = await withEnv(
      { NODE_ENV: 'production', DEV_AUTO_LOGIN: 'true', DEV_AUTO_LOGIN_EMAIL: 'owner@example.com' },
      () => devLogin().expect(404),
    );
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('creates the configured account on a fresh install, so no one has to register first', async () => {
    const res = await withEnv(
      { NODE_ENV: 'development', DEV_AUTO_LOGIN: 'true', DEV_AUTO_LOGIN_EMAIL: 'newcomer@example.com' },
      () => devLogin().expect(200),
    );
    expect(res.body.user.email).toBe('newcomer@example.com');

    const again = await withEnv(
      { NODE_ENV: 'development', DEV_AUTO_LOGIN: 'true', DEV_AUTO_LOGIN_EMAIL: 'newcomer@example.com' },
      () => devLogin().expect(200),
    );
    expect(again.body.user.id).toBe(res.body.user.id);
  });

  it('does nothing without a configured account', async () => {
    await withEnv({ NODE_ENV: 'development', DEV_AUTO_LOGIN: 'true', DEV_AUTO_LOGIN_EMAIL: undefined }, () =>
      devLogin().expect(404),
    );
  });
});
