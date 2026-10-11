import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  localDateOf,
  nextDay,
  type LocalDate,
} from '../src/outage-reader/dnem/windows';
import { PrismaService } from '../src/prisma/prisma.service';
import { TELEGRAM_CLIENT } from '../src/telegram/telegram-client';
import { FakeTelegram } from './support/fake-telegram';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

/** 24 hourly statuses, `yes` unless set: { hour: status }. */
const day = (set: Record<number, string> = {}) =>
  Array.from({ length: 24 }, (_, h) => set[h] ?? 'yes');
const key = (d: LocalDate) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
const WEEK = Object.fromEntries(
  ['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, day()]),
);

describe('Outage schedule notices (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let telegram: FakeTelegram;
  let admin: string;
  let profile: { id: number; name: string };
  let readerToken: string;
  // The checks are made now, about tomorrow (Kyiv).
  const tomorrow = key(nextDay(localDateOf(new Date())));
  let minutes = 0;

  beforeAll(async () => {
    telegram = new FakeTelegram();
    app = await createTestApp((builder) =>
      builder.overrideProvider(TELEGRAM_CLIENT).useValue(telegram),
    );
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    admin = await registerUser(app, 'owner@example.com');
    profile = (
      await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${admin}`)
        .send(sampleProfile)
        .expect(201)
    ).body;
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'owner@example.com' },
    });
    await prisma.telegramLink.create({
      data: { chatId: '1', userId: owner.id },
    });
  });

  beforeEach(async () => {
    telegram.sent = [];
    await prisma.alertEvent.deleteMany();
    await prisma.outageSource.deleteMany();
    const { body } = await request(app.getHttpServer())
      .put(`/api/inverter/profiles/${profile.id}/outage-source`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ city: 'м. Дніпро', street: 'вул. Тестова', house: '12а' })
      .expect(200);
    readerToken = body.token;
  });
  afterAll(() => app.close());

  /** A successful check showing `slots` for tomorrow, a minute after the last. */
  const check = (slots: string[]) =>
    request(app.getHttpServer())
      .post('/api/outage/reader/checks')
      .set('Authorization', `Bearer ${readerToken}`)
      .send({
        checkedAt: new Date(
          Date.now() - 60 * 60_000 + ++minutes * 60_000,
        ).toISOString(),
        outcome: 'ok',
        usedBrowser: false,
        house: { found: true, groups: ['GPV5.2'], outage: null },
        weekly: { 'GPV5.2': WEEK },
        confirmed: { updated: 'x', days: { [tomorrow]: { 'GPV5.2': slots } } },
      })
      .expect(202);

  it('takes the first check as the baseline, then tells the household what changed', async () => {
    await check(day({ 18: 'no', 19: 'no' }));
    expect(telegram.sent).toEqual([]);

    await check(day({ 18: 'no', 19: 'no' }));
    expect(telegram.sent).toEqual([]);

    await check(day({ 18: 'no', 19: 'no', 20: 'no' }));
    expect(telegram.sent).toEqual([
      {
        chatId: '1',
        text: `${profile.name}: Outage schedule updated\nTomorrow 18:00–20:00 → 18:00–21:00 off`,
      },
    ]);
    expect(await prisma.alertEvent.findMany()).toEqual([
      expect.objectContaining({
        kind: 'schedule',
        text: 'Outage schedule updated\nTomorrow 18:00–20:00 → 18:00–21:00 off',
      }),
    ]);
  });

  it('sends nothing to those who turned the notice off', async () => {
    await request(app.getHttpServer())
      .put('/api/notifications/settings')
      .set('Authorization', `Bearer ${admin}`)
      .send({ channels: { schedule: { telegram: false } } })
      .expect(200);
    await check(day());
    await check(day({ 8: 'no' }));
    expect(telegram.sent).toEqual([]);
    // Still on the Alerts page.
    expect(await prisma.alertEvent.count()).toBe(1);
    await request(app.getHttpServer())
      .put('/api/notifications/settings')
      .set('Authorization', `Bearer ${admin}`)
      .send({ channels: { schedule: { telegram: true } } })
      .expect(200);
  });
});
