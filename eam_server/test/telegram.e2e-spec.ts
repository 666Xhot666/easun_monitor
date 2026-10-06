import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  TELEGRAM_CLIENT,
  type TelegramClient,
} from '../src/telegram/telegram-client';
import { TelegramBot } from '../src/telegram/telegram-bot';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

/** Records what the bot sends instead of calling Telegram. */
class FakeTelegram implements TelegramClient {
  sent: { chatId: string; text: string }[] = [];
  getUpdates() {
    return Promise.resolve([]);
  }
  sendMessage(chatId: string, text: string) {
    this.sent.push({ chatId, text });
    return Promise.resolve();
  }
}

describe('Telegram (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let telegram: FakeTelegram;
  let bot: TelegramBot;

  // Few users per file: registration is rate-limited.
  beforeAll(async () => {
    telegram = new FakeTelegram();
    app = await createTestApp((builder) =>
      builder.overrideProvider(TELEGRAM_CLIENT).useValue(telegram),
    );
    bot = app.get(TelegramBot);
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

  describe('the bot', () => {
    const message = (chatId: number, text: string) => ({
      update_id: 1,
      message: { chat: { id: chatId }, text },
    });

    beforeEach(() => (telegram.sent = []));

    it('links a chat with /start <code> and says to whom', async () => {
      const { code } = (await as('post', '/api/telegram/link-code').expect(201))
        .body;

      await bot.handleUpdate(message(4242, `/start ${code}`));

      expect(telegram.sent).toEqual([
        { chatId: '4242', text: expect.stringContaining('owner@example.com') },
      ]);
      expect((await as('get', '/api/telegram/link').expect(200)).body).toEqual({
        linked: true,
      });
    });

    it('refuses a used or wrong code, and explains how to link', async () => {
      await bot.handleUpdate(message(777, '/start NOPENOPE'));
      await bot.handleUpdate(message(777, 'hello'));

      expect(telegram.sent.map((m) => m.chatId)).toEqual(['777', '777']);
      expect(telegram.sent[0].text).toMatch(/code is not valid/i);
      expect(telegram.sent[1].text).toMatch(/Settings/);
    });

    it('unlinks the chat with /stop', async () => {
      await bot.handleUpdate(message(4242, '/stop'));

      expect(telegram.sent[0].text).toMatch(/unlinked/i);
      expect((await as('get', '/api/telegram/link').expect(200)).body).toEqual({
        linked: false,
      });
    });

    it("answers /status and /energy for the user's inverters", async () => {
      const { code } = (await as('post', '/api/telegram/link-code').expect(201))
        .body;
      await bot.handleUpdate(message(5151, `/start ${code}`));
      const profile = (
        await as('post', '/api/inverter/setup').send(sampleProfile).expect(201)
      ).body;
      await app.get(PrismaService).inverterLog.create({
        data: {
          inverterProfileId: profile.id,
          payload: { OperationMode: 3, PVPower: 500, BatterySoc: 77 },
        },
      });
      telegram.sent = [];

      await bot.handleUpdate(message(5151, '/status'));
      await bot.handleUpdate(message(5151, '/energy'));

      expect(telegram.sent[0].text).toMatch(
        new RegExp(`^${profile.name}: Off-grid`),
      );
      expect(telegram.sent[0].text).toContain('Battery 77 %');
      expect(telegram.sent[1].text).toMatch(
        new RegExp(`^${profile.name} today: PV `),
      );
    });

    it('asks an unlinked chat to link first instead of answering /status', async () => {
      await bot.handleUpdate(message(9999, '/status'));
      expect(telegram.sent[0].text).toMatch(/Settings/);
    });
  });
});
