import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, registerUser, resetDatabase } from './helpers';

const PASSWORD = 'correct-horse-battery';

describe('Sessions and password (e2e)', () => {
  let app: INestApplication<App>;

  /** A browser: keeps its refresh cookie and sends its own user agent. */
  async function signIn(userAgent: string) {
    const agent = request.agent(app.getHttpServer());
    const res = await agent
      .post('/api/auth/login')
      .set('User-Agent', userAgent)
      .send({ email: 'me@example.com', password: PASSWORD })
      .expect(200);
    return { agent, token: res.body.accessToken as string };
  }

  beforeEach(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    await registerUser(app, 'me@example.com', PASSWORD);
  });

  afterEach(() => app.close());

  it('lists the signed-in browsers, marking this one, and keeps a session across refreshes', async () => {
    const laptop = await signIn('Mozilla/5.0 (Macintosh) Chrome/140');
    const phone = await signIn('Mozilla/5.0 (iPhone) Safari/18');
    await phone.agent.post('/api/auth/refresh').expect(200);

    const res = await laptop.agent
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${laptop.token}`)
      .expect(200);

    const agents = res.body.map((s: { userAgent: string }) => s.userAgent);
    expect(agents).toEqual(
      expect.arrayContaining([
        'Mozilla/5.0 (Macintosh) Chrome/140',
        'Mozilla/5.0 (iPhone) Safari/18',
      ]),
    );
    // One per browser, not per refresh; the registration's session too.
    expect(res.body).toHaveLength(3);
    const current = res.body.filter((s: { current: boolean }) => s.current);
    expect(current.map((s: { userAgent: string }) => s.userAgent)).toEqual([
      'Mozilla/5.0 (Macintosh) Chrome/140',
    ]);
    expect(typeof res.body[0].lastUsedAt).toBe('string');
  });

  it('signs out one other browser', async () => {
    const laptop = await signIn('Laptop');
    const phone = await signIn('Phone');
    const list = (
      await laptop.agent
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${laptop.token}`)
        .expect(200)
    ).body as { id: string; userAgent: string }[];
    const phoneSession = list.find((s) => s.userAgent === 'Phone')!;

    await laptop.agent
      .delete(`/api/auth/sessions/${phoneSession.id}`)
      .set('Authorization', `Bearer ${laptop.token}`)
      .expect(204);

    await phone.agent.post('/api/auth/refresh').expect(401);
    await laptop.agent.post('/api/auth/refresh').expect(200);
  });

  it("can't sign out another user's session", async () => {
    const laptop = await signIn('Laptop');
    const otherToken = await registerUser(app, 'other@example.com');
    const id = (
      await laptop.agent
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${laptop.token}`)
        .expect(200)
    ).body[0].id as string;

    await request(app.getHttpServer())
      .delete(`/api/auth/sessions/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('changes the password with the current one, signing out the other browsers', async () => {
    const laptop = await signIn('Laptop');
    const phone = await signIn('Phone');

    await laptop.agent
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${laptop.token}`)
      .send({
        currentPassword: 'wrong-password',
        newPassword: 'a-new-long-one',
      })
      .expect(401);
    await laptop.agent
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${laptop.token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'a-new-long-one' })
      .expect(204);

    await phone.agent.post('/api/auth/refresh').expect(401);
    await laptop.agent.post('/api/auth/refresh').expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'me@example.com', password: 'a-new-long-one' })
      .expect(200);
  });

  it('refuses a short new password', async () => {
    const laptop = await signIn('Laptop');
    await laptop.agent
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${laptop.token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'short' })
      .expect(400);
  });
});
