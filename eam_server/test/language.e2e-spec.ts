import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, registerUser, resetDatabase } from './helpers';

describe('Language (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    token = await registerUser(app, 'user@example.com');
  });
  afterAll(() => app.close());

  const me = async () =>
    (
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body;
  const choose = (language: unknown) =>
    request(app.getHttpServer())
      .put('/api/auth/language')
      .set('Authorization', `Bearer ${token}`)
      .send({ language });

  it('has no language until the user chooses one, so the browser decides', async () => {
    expect((await me()).language).toBeNull();
  });

  it('keeps the language the user chooses, English or Ukrainian only', async () => {
    await choose('uk').expect(204);
    expect((await me()).language).toBe('uk');
    await choose('en').expect(204);
    expect((await me()).language).toBe('en');
    for (const wrong of ['ru', 'de', '', 5, null]) {
      await choose(wrong).expect(400);
    }
    expect((await me()).language).toBe('en');
  });

  it('is for a signed-in user only', async () => {
    await request(app.getHttpServer())
      .put('/api/auth/language')
      .send({ language: 'uk' })
      .expect(401);
  });

  it('words error messages in the language the request asks for', async () => {
    const login = (password: string, language?: string) => {
      const r = request(app.getHttpServer()).post('/api/auth/login');
      if (language) r.set('Accept-Language', language);
      return r.send({ email: 'user@example.com', password });
    };

    const uk = await login('wrong-password', 'uk-UA,uk;q=0.9').expect(401);
    expect(uk.body).toEqual({
      statusCode: 401,
      message: 'Неправильна пошта або пароль',
    });
    expect((await login('wrong-password').expect(401)).body.message).toBe(
      'Invalid email or password',
    );
    expect((await login('wrong-password', 'ru').expect(401)).body.message).toBe(
      'Invalid email or password',
    );

    const short = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('Accept-Language', 'uk')
      .send({ email: 'other@example.com', password: 'short' })
      .expect(400);
    expect(short.body.message).toContain(
      'Пароль має містити щонайменше 8 символів',
    );
  });
});
