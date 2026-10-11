import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  localDateOf,
  nextDay,
  type LocalDate,
} from '../src/outage-reader/dnem/windows';
import { NotificationSettingsService } from '../src/notifications/notification-settings.service';
import { OutageForecastService } from '../src/outage/outage-forecast.service';
import { OutageReminders } from '../src/outage/outage-reminders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelegramAlerts } from '../src/telegram/telegram-alerts';
import { TelemetryStore } from '../src/telemetry/telemetry.store';
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

  describe('Outage soon', () => {
    const MIN = 60_000;
    // An outage at 18:00–20:00 Kyiv on a fixed day, checked shortly before.
    const start = new Date('2026-10-12T15:00:00Z');
    const end = new Date('2026-10-12T17:00:00Z');
    const at = (minutesBefore: number) =>
      new Date(start.getTime() - minutesBefore * MIN);
    /** A fresh service: its first round is the baseline. */
    const reminders = () =>
      new OutageReminders(
        prisma,
        app.get(OutageForecastService),
        app.get(TelegramAlerts),
        app.get(NotificationSettingsService),
        app.get(TelemetryStore),
      );

    beforeEach(async () => {
      const source = await prisma.outageSource.update({
        where: { inverterProfileId: profile.id },
        data: { houseState: 'FOUND', groups: ['GPV5.2'] },
      });
      await prisma.outageCheck.create({
        data: { sourceId: source.id, checkedAt: at(60), outcome: 'OK' },
      });
      const event = (status: 'OFF' | 'POSSIBLE', from: Date, to: Date) => ({
        sourceId: source.id,
        kind: 'SCHEDULE' as const,
        status,
        start: from,
        end: to,
        announcedStart: from,
        announcedEnd: to,
        firstSeenAt: at(60),
        lastSeenAt: at(60),
      });
      await prisma.outageEvent.createMany({
        data: [
          event('OFF', start, end),
          // A possible outage later on: only for those who asked.
          event(
            'POSSIBLE',
            new Date(end.getTime() + 60 * MIN),
            new Date(end.getTime() + 120 * MIN),
          ),
        ],
      });
      await prisma.inverterLog.deleteMany();
      await prisma.inverterLog.create({
        data: {
          inverterProfileId: profile.id,
          timestamp: at(16),
          payload: { BatterySoc: 64 },
        },
      });
    });

    it('reminds the lead time before a confirmed outage, once, with the battery level', async () => {
      const service = reminders();
      await service.tick(at(30)); // the baseline: nothing due yet
      await service.tick(at(16));
      expect(telegram.sent).toEqual([]);

      await service.tick(at(15));
      await service.tick(at(14));
      const text = 'Outage in 15 min: 18:00–20:00\nBattery 64 %';
      expect(telegram.sent).toEqual([
        { chatId: '1', text: `${profile.name}: ${text}` },
      ]);
      expect(await prisma.alertEvent.findMany()).toEqual([
        expect.objectContaining({ kind: 'outage', text }),
      ]);
    });

    it('does not resend after a restart', async () => {
      await reminders().tick(at(15));
      await reminders().tick(at(10));
      // Each fresh service takes its first round as the baseline.
      expect(telegram.sent).toEqual([]);
    });

    it("follows the member's lead time and possible outages choice", async () => {
      await request(app.getHttpServer())
        .put('/api/notifications/settings')
        .set('Authorization', `Bearer ${admin}`)
        .send({ outageLeadMinutes: 30, possibleOutages: true })
        .expect(200);
      const service = reminders();
      await service.tick(at(60));
      await service.tick(at(30));
      expect(telegram.sent.map((m) => m.text.split('\n')[0])).toEqual([
        `${profile.name}: Outage in 30 min: 18:00–20:00`,
      ]);
      await service.tick(new Date(end.getTime() + 30 * MIN));
      expect(telegram.sent.map((m) => m.text.split('\n')[0])[1]).toBe(
        `${profile.name}: Possible outage in 30 min: 21:00–22:00`,
      );
      await request(app.getHttpServer())
        .put('/api/notifications/settings')
        .set('Authorization', `Bearer ${admin}`)
        .send({ outageLeadMinutes: 15, possibleOutages: false })
        .expect(200);
    });
  });
});
