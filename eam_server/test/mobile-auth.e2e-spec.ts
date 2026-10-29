import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, registerUser, resetDatabase } from './helpers';

const PASSWORD = 'correct-horse-battery';
const MOBILE = { 'X-EAM-Client': 'mobile' };

describe('Sign-in for the mobile app (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    await registerUser(app, 'me@example.com', PASSWORD);
  });

  afterAll(() => app.close());

  const post = (path: string) =>
    request(app.getHttpServer()).post(path).set(MOBILE);

  const signIn = async () => {
    const res = await post('/api/auth/login')
      .send({ email: 'me@example.com', password: PASSWORD })
      .expect(200);
    return res;
  };

  it('gives the refresh token in the body, and no cookie', async () => {
    const res = await signIn();
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
    expect(Date.parse(res.body.refreshTokenExpiresAt)).toBeGreaterThan(
      Date.now(),
    );
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refreshes with the token in the body, which is then used up', async () => {
    const { body } = await signIn();
    const next = await post('/api/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(200);
    expect(typeof next.body.accessToken).toBe('string');
    expect(next.body.refreshToken).not.toBe(body.refreshToken);
    expect(next.headers['set-cookie']).toBeUndefined();

    await post('/api/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${next.body.accessToken}`)
      .expect(200);
  });

  it('signs out with the token in the body', async () => {
    const { body } = await signIn();
    await post('/api/auth/logout')
      .send({ refreshToken: body.refreshToken })
      .expect(204);
    await post('/api/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(401);
  });

  it('keeps browsers on the cookie: no refresh token in their body, none taken from it', async () => {
    const browser = request.agent(app.getHttpServer());
    const res = await browser
      .post('/api/auth/login')
      .send({ email: 'me@example.com', password: PASSWORD })
      .expect(200);
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeDefined();

    const { body } = await signIn();
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(401);
  });
});
