import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type { StreetReading } from '../src/outage-reader/dnem/read-street';
import type { DaySlots } from '../src/outage-reader/dnem/schedule-page';
import { SiteError } from '../src/outage-reader/dnem/site-error';
import { runCheck } from '../src/outage-reader/run-check';
import { ReaderServerClient } from '../src/outage-reader/server-client';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

const day = (set: Record<number, string> = {}) =>
  Array.from({ length: 24 }, (_, h) => set[h] ?? 'yes') as DaySlots;
// Kyiv midnight of 2026-10-11 (UTC+3).
const SUN = 1791666000;

const reading: StreetReading = {
  usedBrowser: false,
  page: {
    ajaxUrl: 'x',
    csrfToken: 't',
    streets: { 'м. Дніпро': ['вул. Тестова'] },
    weekly: {
      groupNames: { 'GPV5.2': 'Черга 5.2' },
      groups: {
        'GPV5.2': Object.fromEntries(
          [1, 2, 3, 4, 5, 6, 7].map((d) => [d, day({ 8: 'maybe' })]),
        ),
      },
    },
    confirmed: {
      today: SUN - 86400,
      updated: '10.10.2026 20:40',
      days: { [SUN]: { 'GPV5.2': day({ 18: 'no' }) } },
    },
  },
  houses: {
    '12а': {
      groups: ['GPV5.2'],
      outage: {
        description: 'Аварійні ремонтні роботи',
        type: '2',
        start: new Date('2026-10-10T15:05:00Z'),
        end: new Date('2026-10-10T22:55:00Z'),
      },
    },
  },
};

describe('Outage reader against the server (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    const admin = await registerUser(app, 'admin@example.com');
    const profileId = (
      await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${admin}`)
        .send(sampleProfile)
        .expect(201)
    ).body.id;
    token = (
      await request(app.getHttpServer())
        .put(`/api/inverter/profiles/${profileId}/outage-source`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ city: 'м. Дніпро', street: 'вул. Тестова', house: '12a' })
        .expect(200)
    ).body.token;
  });
  afterAll(() => app.close());

  it("delivers a check the server accepts and stores, house typed with a Latin 'a'", async () => {
    const logs: string[] = [];
    const { result } = await runCheck(
      {
        server: new ReaderServerClient({ url: await app.getUrl(), token }),
        read: () => Promise.resolve(reading),
        now: () => new Date('2026-10-10T17:00:00Z'),
        browserEveryDays: 7,
        log: (m) => logs.push(m),
      },
      { lastBrowserCheckAt: '2026-10-10T00:00:00.000Z', streetsHash: null },
    );

    expect({ result, logs }).toEqual({
      result: { kind: 'ok', usedBrowser: false },
      logs: ['Checked: groups GPV5.2'],
    });
    expect(await prisma.outageSource.findFirstOrThrow()).toMatchObject({
      houseState: 'FOUND',
      groups: ['GPV5.2'],
    });
    expect(await prisma.outageSiteStreets.count()).toBe(1);
    expect(await prisma.outageWeeklyPattern.count()).toBe(1);
    expect(await prisma.outageConfirmedDay.count()).toBe(1);
    expect(
      (await prisma.outageEvent.findMany({ orderBy: { start: 'asc' } })).map(
        (e) => [e.kind, e.start.toISOString(), e.end.toISOString()],
      ),
    ).toEqual([
      ['REPAIR', '2026-10-10T15:05:00.000Z', '2026-10-10T22:55:00.000Z'],
      ['SCHEDULE', '2026-10-11T15:00:00.000Z', '2026-10-11T16:00:00.000Z'],
    ]);
  });

  it('delivers a failed check the server accepts', async () => {
    const { result } = await runCheck(
      {
        server: new ReaderServerClient({ url: await app.getUrl(), token }),
        read: () =>
          Promise.reject(
            new SiteError('network', 'No answer from the site: fetch failed'),
          ),
        now: () => new Date('2026-10-10T19:00:00Z'),
        browserEveryDays: 7,
        log: () => {},
      },
      { lastBrowserCheckAt: '2026-10-10T00:00:00.000Z', streetsHash: null },
    );
    expect(result).toEqual({
      kind: 'failed',
      error: 'network',
      blocked: false,
    });
    expect(
      await prisma.outageCheck.findFirst({ where: { outcome: 'NETWORK' } }),
    ).toMatchObject({ error: 'No answer from the site: fetch failed' });
  });
});
