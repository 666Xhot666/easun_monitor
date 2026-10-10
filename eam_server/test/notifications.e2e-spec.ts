import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelegramAlerts } from '../src/telegram/telegram-alerts';
import { TelegramSummary } from '../src/telegram/telegram-summary';
import { TELEGRAM_CLIENT } from '../src/telegram/telegram-client';
import { FakeTelegram } from './support/fake-telegram';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

describe('Notification settings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let telegram: FakeTelegram;
  let owner: string;
  let reader: string;
  let profileId: number;

  const settings = (token: string) =>
    request(app.getHttpServer())
      .get('/api/notifications/settings')
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    telegram = new FakeTelegram();
    app = await createTestApp((builder) =>
      builder.overrideProvider(TELEGRAM_CLIENT).useValue(telegram),
    );
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    owner = await registerUser(app, 'owner@example.com');
    reader = await registerUser(app, 'reader@example.com');
    const created = (
      await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${owner}`)
        .send(sampleProfile)
        .expect(201)
    ).body;
    profileId = created.id;
    const [ownerUser, readerUser] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'reader@example.com' } }),
    ]);
    await prisma.membership.create({
      data: {
        userId: readerUser.id,
        householdId: created.householdId,
        role: 'READER',
      },
    });
    await prisma.telegramLink.createMany({
      data: [
        { chatId: '1', userId: ownerUser.id },
        { chatId: '2', userId: readerUser.id },
      ],
    });
  });

  afterAll(() => app.close());
  beforeEach(() => (telegram.sent = []));

  it('starts with everything going to Telegram', async () => {
    const res = await settings(owner).expect(200);
    expect(res.body.channels.grid).toEqual({ inApp: true, telegram: true });
    expect(res.body.channels.summary).toEqual({
      inApp: false,
      telegram: true,
    });
    expect(res.body.quietHours).toBe(false);
  });

  it("saves a user's choices and applies them to their chat only", async () => {
    const saved = await request(app.getHttpServer())
      .put('/api/notifications/settings')
      .set('Authorization', `Bearer ${owner}`)
      .send({ channels: { grid: { telegram: false } } })
      .expect(200);
    expect(saved.body.channels.grid).toEqual({ inApp: true, telegram: false });
    expect(
      (await settings(owner).expect(200)).body.channels.grid.telegram,
    ).toBe(false);
    expect(
      (await settings(reader).expect(200)).body.channels.grid.telegram,
    ).toBe(true);

    const alerts = app.get(TelegramAlerts);
    await alerts.onReading(profileId, { MainsVoltage: 230 });
    await alerts.onReading(profileId, { MainsVoltage: 0 });

    expect(telegram.sent.map((m) => m.chatId)).toEqual(['2']);
    // Still recorded for the Alerts page.
    expect(
      await prisma.alertEvent.count({
        where: { inverterProfileId: profileId, text: 'Grid lost' },
      }),
    ).toBe(1);
  });

  it('leaves the evening summary out for a user who turned it off', async () => {
    await request(app.getHttpServer())
      .put('/api/notifications/settings')
      .set('Authorization', `Bearer ${reader}`)
      .send({ channels: { summary: { telegram: false } } })
      .expect(200);

    await app.get(TelegramSummary).sendIfDue(new Date('2026-10-07T21:00:00Z'));

    expect(telegram.sent.map((m) => m.chatId)).toEqual(['1']);
  });

  it('refuses a change that is not settings', async () => {
    await request(app.getHttpServer())
      .put('/api/notifications/settings')
      .set('Authorization', `Bearer ${owner}`)
      .send('nonsense')
      .expect(400);
  });
});
