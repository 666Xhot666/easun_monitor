import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelegramAlerts } from '../src/telegram/telegram-alerts';
import { TelegramSummary } from '../src/telegram/telegram-summary';
import {
  TELEGRAM_CLIENT,
  type TelegramClient,
} from '../src/telegram/telegram-client';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

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

const MINUTE = 60_000;

describe('Telegram alerts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let telegram: FakeTelegram;
  let alerts: TelegramAlerts;
  let profile: { id: number; name: string; householdId: number };

  beforeAll(async () => {
    telegram = new FakeTelegram();
    app = await createTestApp((builder) =>
      builder.overrideProvider(TELEGRAM_CLIENT).useValue(telegram),
    );
    prisma = app.get(PrismaService);
    alerts = app.get(TelegramAlerts);
    await resetDatabase(app);
    const token = await registerUser(app, 'owner@example.com');
    profile = (
      await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${token}`)
        .send(sampleProfile)
        .expect(201)
    ).body;

    // Chats: the owner, a reader of the same household, and a stranger.
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'owner@example.com' },
    });
    const reader = await prisma.user.create({
      data: {
        email: 'reader@example.com',
        passwordHash: 'x',
        memberships: {
          create: { role: 'READER', householdId: profile.householdId },
        },
      },
    });
    const stranger = await prisma.user.create({
      data: {
        email: 'stranger@example.com',
        passwordHash: 'x',
        memberships: {
          create: { role: 'ADMIN', household: { create: { name: 'Other' } } },
        },
      },
    });
    await prisma.telegramLink.createMany({
      data: [
        { chatId: '1', userId: owner.id },
        { chatId: '2', userId: reader.id },
        { chatId: '3', userId: stranger.id },
      ],
    });
  });

  afterAll(() => app.close());
  beforeEach(() => (telegram.sent = []));

  it("sends reading changes to every linked member of the inverter's household", async () => {
    await alerts.onReading(profile.id, { MainsVoltage: 230 });
    await alerts.onReading(profile.id, { MainsVoltage: 0 });

    expect(telegram.sent).toEqual([
      { chatId: '1', text: `${profile.name}: Grid lost` },
      { chatId: '2', text: `${profile.name}: Grid lost` },
    ]);
  });

  it('says a logger is offline after 5 minutes down, and when it is back', async () => {
    const t0 = new Date('2026-10-07T00:00:00Z');
    await alerts.onLogger(profile.id, false, t0);
    await alerts.checkOffline(new Date(t0.getTime() + 4 * MINUTE));
    expect(telegram.sent).toEqual([]);

    await alerts.checkOffline(new Date(t0.getTime() + 5 * MINUTE));
    await alerts.checkOffline(new Date(t0.getTime() + 6 * MINUTE));
    await alerts.onLogger(
      profile.id,
      true,
      new Date(t0.getTime() + 7 * MINUTE),
    );

    expect(
      telegram.sent.filter((m) => m.chatId === '1').map((m) => m.text),
    ).toEqual([
      `${profile.name}: Logger offline for 5 min`,
      `${profile.name}: Logger back online`,
    ]);
  });

  it('says nothing for a logger that recovers within 5 minutes', async () => {
    const t0 = new Date('2026-10-07T01:00:00Z');
    await alerts.onLogger(profile.id, false, t0);
    await alerts.onLogger(
      profile.id,
      true,
      new Date(t0.getTime() + 2 * MINUTE),
    );
    await alerts.checkOffline(new Date(t0.getTime() + 6 * MINUTE));

    expect(telegram.sent).toEqual([]);
  });

  it('reports BMS alarms and a silent BMS reader', async () => {
    const now = new Date();
    const device = await prisma.bmsDevice.create({
      data: {
        name: 'Pack',
        sourceType: 'mac-ble',
        tokenHash: 'h',
        inverterProfileId: profile.id,
        lastSeenAt: now,
      },
    });
    await alerts.onBmsReading(device.id, []);
    await alerts.onBmsReading(device.id, ['Cell overvoltage']);
    await alerts.checkOffline(new Date(now.getTime() + 5 * MINUTE));
    await prisma.bmsDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date(now.getTime() + 6 * MINUTE) },
    });
    await alerts.checkOffline(new Date(now.getTime() + 6 * MINUTE));

    expect(
      telegram.sent.filter((m) => m.chatId === '1').map((m) => m.text),
    ).toEqual([
      `${profile.name} (Pack): BMS alarm: Cell overvoltage`,
      `${profile.name} (Pack): BMS reader offline for 5 min`,
      `${profile.name} (Pack): BMS reader back online`,
    ]);
  });

  it("sends each linked chat an evening summary of its households' inverters, once a day", async () => {
    const summary = app.get(TelegramSummary);
    // Default time 21:00, in TIME_ZONE (unset in tests: UTC).
    await summary.sendIfDue(new Date('2026-10-07T20:59:00Z'));
    expect(telegram.sent).toEqual([]);

    await summary.sendIfDue(new Date('2026-10-07T21:00:00Z'));
    await summary.sendIfDue(new Date('2026-10-07T21:01:00Z'));

    // The stranger's household has no inverters: no summary for chat 3.
    expect(telegram.sent.map((m) => m.chatId)).toEqual(['1', '2']);
    expect(telegram.sent[0].text).toMatch(
      new RegExp(`^Evening summary\\n${profile.name} today: PV `),
    );

    await summary.sendIfDue(new Date('2026-10-08T21:00:30Z'));
    expect(telegram.sent).toHaveLength(4);
  });
});
