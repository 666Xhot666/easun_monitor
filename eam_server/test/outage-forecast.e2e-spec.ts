import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  localDateOf,
  nextDay,
  wallToUtc,
  type LocalDate,
} from '../src/outage-reader/dnem/windows';
import { PrismaService } from '../src/prisma/prisma.service';
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

describe('Outage forecast (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let profileId: number;
  let readerToken: string;

  // The forecast is for the real today and tomorrow.
  const today = localDateOf(new Date());
  const tomorrow = nextDay(today);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    admin = await registerUser(app, 'admin@example.com');
    profileId = (
      await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${admin}`)
        .send(sampleProfile)
        .expect(201)
    ).body.id;
  });

  beforeEach(async () => {
    await prisma.outageSource.deleteMany();
    const { body } = await request(app.getHttpServer())
      .put(`/api/inverter/profiles/${profileId}/outage-source`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ city: 'м. Тестове', street: 'вул. Тестова', house: '12а' })
      .expect(200);
    readerToken = body.token;
  });
  afterAll(() => app.close());

  const send = (check: object) =>
    request(app.getHttpServer())
      .post('/api/outage/reader/checks')
      .set('Authorization', `Bearer ${readerToken}`)
      .send(check)
      .expect(202);

  const forecast = (token = admin) =>
    request(app.getHttpServer())
      .get(`/api/inverter/profiles/${profileId}/outage-forecast`)
      .set('Authorization', `Bearer ${token}`);

  it('gives today from the confirmed schedule and tomorrow from the weekly pattern', async () => {
    const checkedAt = new Date(Date.now() - 60_000).toISOString();
    const weekday = day({ 10: 'no' });
    await send({
      checkedAt,
      outcome: 'ok',
      usedBrowser: false,
      house: { found: true, groups: ['GPV5.2'], outage: null },
      weekly: {
        'GPV5.2': Object.fromEntries(
          ['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, weekday]),
        ),
      },
      confirmed: {
        updated: '11.10.2026 08:00',
        days: { [key(today)]: { 'GPV5.2': day().map(() => 'no') } },
      },
    });

    const { body } = await forecast().expect(200);
    const todayOff = {
      start: new Date(wallToUtc(today, 0)).toISOString(),
      end: new Date(wallToUtc(tomorrow, 0)).toISOString(),
      status: 'off',
      source: 'schedule',
      description: null,
    };
    const tomorrowWeekly = {
      start: new Date(wallToUtc(tomorrow, 10 * 60)).toISOString(),
      end: new Date(wallToUtc(tomorrow, 11 * 60)).toISOString(),
      status: 'off',
      source: 'weekly',
      description: null,
    };
    expect(body).toMatchObject({
      state: 'fresh',
      groups: ['GPV5.2'],
      lastOkAt: checkedAt,
      lastCheck: { checkedAt, outcome: 'OK', error: null },
      windows: [todayOff, tomorrowWeekly],
      now: { status: 'off', window: todayOff },
      next: tomorrowWeekly,
    });
    expect(body.dataAgeMinutes).toBeGreaterThanOrEqual(0);
  });

  it('says the data is stale when no check has succeeded', async () => {
    await send({
      checkedAt: new Date().toISOString(),
      outcome: 'challenge',
      usedBrowser: true,
      error: 'The site answered with a firewall challenge',
    });
    // The house is looked up by a successful check only.
    await prisma.outageSource.updateMany({
      data: { houseState: 'FOUND', groups: ['GPV5.2'] },
    });
    const { body } = await forecast().expect(200);
    expect(body).toMatchObject({
      state: 'stale',
      lastOkAt: null,
      lastCheck: { outcome: 'CHALLENGE' },
      windows: [],
      now: { status: 'unknown', window: null },
    });
  });

  it('says when no address is set', async () => {
    await prisma.outageSource.deleteMany();
    const { body } = await forecast().expect(200);
    expect(body).toMatchObject({ state: 'none', windows: [] });
  });

  it('is only for members of the inverter household', async () => {
    const stranger = await registerUser(app, 'stranger@example.com');
    await forecast(stranger).expect(404);
  });
});
