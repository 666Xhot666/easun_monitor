import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
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
const week = (monday = day()) => ({
  '1': monday,
  '2': day(),
  '3': day(),
  '4': day(),
  '5': day(),
  '6': day(),
  '7': day(),
});

const okCheck = (over: Record<string, unknown> = {}) => ({
  checkedAt: '2026-10-10T17:00:00.000Z',
  outcome: 'ok',
  usedBrowser: false,
  house: { found: true, groups: ['GPV5.2'], outage: null },
  weekly: { 'GPV5.2': week(day({ 8: 'maybe' })) },
  confirmed: {
    updated: '10.10.2026 20:40',
    days: { '2026-10-11': { 'GPV5.2': day({ 18: 'no', 19: 'no' }) } },
  },
  ...over,
});

describe('Outage schedule checks (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let profileId: number;
  let readerToken: string;
  let sourceId: number;

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
      .send({ city: 'м. Дніпро', street: 'вул. Тестова', house: '12а' })
      .expect(200);
    readerToken = body.token;
    sourceId = body.source.id;
  });
  afterAll(() => app.close());

  const send = (check: object, token = readerToken) =>
    request(app.getHttpServer())
      .post('/api/outage/reader/checks')
      .set('Authorization', `Bearer ${token}`)
      .send(check);

  const source = () =>
    prisma.outageSource.findUniqueOrThrow({ where: { id: sourceId } });

  it('stores a successful check: the house, its weekly pattern and confirmed days', async () => {
    const { body } = await send(okCheck()).expect(202);
    expect(body).toEqual({ stored: true });

    expect(await source()).toMatchObject({
      houseState: 'FOUND',
      groups: ['GPV5.2'],
    });
    expect(await prisma.outageCheck.findMany()).toEqual([
      expect.objectContaining({
        sourceId,
        checkedAt: new Date('2026-10-10T17:00:00Z'),
        outcome: 'OK',
        usedBrowser: false,
        error: null,
      }),
    ]);
    const patterns = await prisma.outageWeeklyPattern.findMany();
    expect(patterns).toEqual([
      expect.objectContaining({
        group: 'GPV5.2',
        days: week(day({ 8: 'maybe' })),
        seenAt: new Date('2026-10-10T17:00:00Z'),
      }),
    ]);
    const days = await prisma.outageConfirmedDay.findMany();
    expect(days).toEqual([
      expect.objectContaining({
        day: new Date('2026-10-11T00:00:00Z'),
        group: 'GPV5.2',
        slots: day({ 18: 'no', 19: 'no' }),
        siteUpdated: '10.10.2026 20:40',
        firstSeenAt: new Date('2026-10-10T17:00:00Z'),
        changedAt: new Date('2026-10-10T17:00:00Z'),
      }),
    ]);
  });

  it('stores a re-sent check once', async () => {
    await send(okCheck()).expect(202);
    const { body } = await send(okCheck()).expect(202);
    expect(body).toEqual({ stored: false });
    expect(await prisma.outageCheck.count()).toBe(1);
  });

  it('keeps one version of an unchanged weekly pattern, and adds one when it changes', async () => {
    await send(okCheck()).expect(202);
    await send(okCheck({ checkedAt: '2026-10-10T19:00:00.000Z' })).expect(202);
    expect(await prisma.outageWeeklyPattern.count()).toBe(1);

    await send(
      okCheck({
        checkedAt: '2026-10-10T21:00:00.000Z',
        weekly: { 'GPV5.2': week(day({ 9: 'maybe' })) },
      }),
    ).expect(202);
    const versions = await prisma.outageWeeklyPattern.findMany({
      orderBy: { seenAt: 'asc' },
    });
    expect(versions.map((v) => v.seenAt.toISOString())).toEqual([
      '2026-10-10T17:00:00.000Z',
      '2026-10-10T21:00:00.000Z',
    ]);
  });

  it("keeps a confirmed day's latest version and when it was first seen", async () => {
    await send(okCheck()).expect(202);
    // Same slots, newer site stamp: not a change.
    await send(
      okCheck({
        checkedAt: '2026-10-10T18:00:00.000Z',
        confirmed: {
          updated: '10.10.2026 21:00',
          days: { '2026-10-11': { 'GPV5.2': day({ 18: 'no', 19: 'no' }) } },
        },
      }),
    ).expect(202);
    await send(
      okCheck({
        checkedAt: '2026-10-10T19:00:00.000Z',
        confirmed: {
          updated: '10.10.2026 22:10',
          days: {
            '2026-10-11': { 'GPV5.2': day({ 18: 'no', 19: 'no', 20: 'no' }) },
          },
        },
      }),
    ).expect(202);

    const [stored] = await prisma.outageConfirmedDay.findMany();
    expect(stored).toMatchObject({
      slots: day({ 18: 'no', 19: 'no', 20: 'no' }),
      siteUpdated: '10.10.2026 22:10',
      firstSeenAt: new Date('2026-10-10T17:00:00Z'),
      changedAt: new Date('2026-10-10T19:00:00Z'),
    });
    expect(await prisma.outageConfirmedDay.count()).toBe(1);
  });

  it('logs a check that arrives after a newer one without letting it overwrite', async () => {
    await send(
      okCheck({
        checkedAt: '2026-10-10T19:00:00.000Z',
        house: { found: true, groups: ['GPV1.1'], outage: null },
        weekly: { 'GPV1.1': week() },
        confirmed: { updated: '10.10.2026 22:00', days: {} },
      }),
    ).expect(202);
    await send(okCheck({ checkedAt: '2026-10-10T17:00:00.000Z' })).expect(202);

    expect(await prisma.outageCheck.count()).toBe(2);
    expect(await source()).toMatchObject({ groups: ['GPV1.1'] });
    expect(await prisma.outageConfirmedDay.count()).toBe(0);
    expect(
      (await prisma.outageWeeklyPattern.findMany()).map((p) => p.group),
    ).toEqual(['GPV1.1']);
  });

  it('records a house that is not on the street', async () => {
    await send(
      okCheck({
        house: { found: false },
        weekly: {},
        confirmed: { updated: '10.10.2026 20:40', days: {} },
      }),
    ).expect(202);
    expect(await source()).toMatchObject({
      houseState: 'NOT_FOUND',
      groups: [],
    });
  });

  it('logs a failed check without touching what was found before', async () => {
    await send(okCheck()).expect(202);
    await send({
      checkedAt: '2026-10-10T19:00:00.000Z',
      outcome: 'challenge',
      usedBrowser: true,
      error: 'The site answered with a firewall challenge',
    }).expect(202);

    const checks = await prisma.outageCheck.findMany({
      orderBy: { checkedAt: 'asc' },
    });
    expect(checks[1]).toMatchObject({
      outcome: 'CHALLENGE',
      usedBrowser: true,
      error: 'The site answered with a firewall challenge',
    });
    expect(await source()).toMatchObject({
      houseState: 'FOUND',
      groups: ['GPV5.2'],
    });
    expect(await prisma.outageConfirmedDay.count()).toBe(1);
  });

  it('accepts a current outage on the house', async () => {
    await send(
      okCheck({
        house: {
          found: true,
          groups: ['GPV5.2'],
          outage: {
            description: 'Аварійні ремонтні роботи',
            type: '2',
            start: '2026-10-10T15:05:00.000Z',
            end: '2026-10-10T19:05:00.000Z',
          },
        },
      }),
    ).expect(202);
  });

  it('rejects a check in an unexpected form', async () => {
    const bad = [
      okCheck({ outcome: 'fine' }),
      okCheck({ checkedAt: 'yesterday' }),
      okCheck({ house: undefined }),
      okCheck({ weekly: { 'GPV5.2': { ...week(), '3': day().slice(0, 23) } } }),
      okCheck({ weekly: { 'GPV5.2': { ...week(), '3': day({ 2: 'off' }) } } }),
      okCheck({ weekly: { 'GPV5.2': { '1': day() } } }),
      okCheck({
        confirmed: { updated: 'x', days: { tomorrow: { 'GPV5.2': day() } } },
      }),
      okCheck({ house: { found: true, groups: 'GPV5.2', outage: null } }),
      okCheck({ house: { found: true, groups: [], outage: { start: 'now' } } }),
      { checkedAt: '2026-10-10T19:00:00.000Z', outcome: 'server' },
    ];
    for (const check of bad) {
      await send(check).expect(400);
    }
    expect(await prisma.outageCheck.count()).toBe(0);
  });

  describe('outage events', () => {
    const repair = (start: string, end: string) => ({
      found: true,
      groups: ['GPV5.2'],
      outage: {
        description: 'Аварійні ремонтні роботи',
        type: '2',
        start,
        end,
      },
    });
    const noDays = { updated: '10.10.2026 20:40', days: {} };
    const events = () =>
      prisma.outageEvent.findMany({ orderBy: { start: 'asc' } });

    it('keeps a repair that gets extended as one event, with its first announced end', async () => {
      await send(
        okCheck({
          checkedAt: '2026-10-10T15:00:00.000Z',
          house: repair('2026-10-10T15:05:00.000Z', '2026-10-10T19:05:00.000Z'),
          confirmed: noDays,
        }),
      ).expect(202);
      await send(
        okCheck({
          checkedAt: '2026-10-10T17:00:00.000Z',
          house: repair('2026-10-10T15:05:00.000Z', '2026-10-10T22:55:00.000Z'),
          confirmed: noDays,
        }),
      ).expect(202);

      expect(await events()).toEqual([
        expect.objectContaining({
          kind: 'REPAIR',
          status: 'OFF',
          description: 'Аварійні ремонтні роботи',
          start: new Date('2026-10-10T15:05:00Z'),
          end: new Date('2026-10-10T22:55:00Z'),
          announcedStart: new Date('2026-10-10T15:05:00Z'),
          announcedEnd: new Date('2026-10-10T19:05:00Z'),
          firstSeenAt: new Date('2026-10-10T15:00:00Z'),
          lastSeenAt: new Date('2026-10-10T17:00:00Z'),
          revisedAt: new Date('2026-10-10T17:00:00Z'),
          withdrawnAt: null,
        }),
      ]);
    });

    it('withdraws a repair that is gone before its end, and leaves a finished one alone', async () => {
      await send(
        okCheck({
          checkedAt: '2026-10-10T15:00:00.000Z',
          house: repair('2026-10-10T15:05:00.000Z', '2026-10-10T22:55:00.000Z'),
          confirmed: noDays,
        }),
      ).expect(202);
      await send(
        okCheck({ checkedAt: '2026-10-10T19:00:00.000Z', confirmed: noDays }),
      ).expect(202);
      expect((await events())[0].withdrawnAt).toEqual(
        new Date('2026-10-10T19:00:00Z'),
      );

      await prisma.outageEvent.deleteMany();
      await send(
        okCheck({
          checkedAt: '2026-10-10T21:00:00.000Z',
          house: repair('2026-10-10T20:00:00.000Z', '2026-10-10T21:30:00.000Z'),
          confirmed: noDays,
        }),
      ).expect(202);
      await send(
        okCheck({ checkedAt: '2026-10-10T22:00:00.000Z', confirmed: noDays }),
      ).expect(202);
      expect((await events())[0].withdrawnAt).toBeNull();
    });

    it("follows a confirmed day's outage as it is extended and then cancelled", async () => {
      // 2026-10-11 18:00-20:00 Kyiv (UTC+3), then 18:00-21:00, then none.
      const tomorrow = (slots: string[]) => ({
        updated: '10.10.2026 20:40',
        days: { '2026-10-11': { 'GPV5.2': slots } },
      });
      await send(
        okCheck({
          checkedAt: '2026-10-10T16:00:00.000Z',
          confirmed: tomorrow(day({ 18: 'no', 19: 'no' })),
        }),
      ).expect(202);
      await send(
        okCheck({
          checkedAt: '2026-10-10T18:00:00.000Z',
          confirmed: tomorrow(day({ 18: 'no', 19: 'no', 20: 'no' })),
        }),
      ).expect(202);

      expect(await events()).toEqual([
        expect.objectContaining({
          kind: 'SCHEDULE',
          status: 'OFF',
          description: null,
          start: new Date('2026-10-11T15:00:00Z'),
          end: new Date('2026-10-11T18:00:00Z'),
          announcedEnd: new Date('2026-10-11T17:00:00Z'),
          revisedAt: new Date('2026-10-10T18:00:00Z'),
        }),
      ]);

      await send(
        okCheck({
          checkedAt: '2026-10-10T20:00:00.000Z',
          confirmed: tomorrow(day()),
        }),
      ).expect(202);
      expect((await events())[0].withdrawnAt).toEqual(
        new Date('2026-10-10T20:00:00Z'),
      );
    });

    it('records possible outages of the confirmed schedule apart from definite ones', async () => {
      await send(
        okCheck({
          checkedAt: '2026-10-10T16:00:00.000Z',
          confirmed: {
            updated: 'x',
            days: { '2026-10-11': { 'GPV5.2': day({ 8: 'maybe', 9: 'no' }) } },
          },
        }),
      ).expect(202);
      expect(
        (await events()).map((e) => [e.status, e.start.toISOString()]),
      ).toEqual([
        ['POSSIBLE', '2026-10-11T05:00:00.000Z'],
        ['OFF', '2026-10-11T06:00:00.000Z'],
      ]);
    });

    it('leaves past outages and days the site no longer shows as they were', async () => {
      // 06:00-07:00 Kyiv on the 11th, then checks after it ended.
      await send(
        okCheck({
          checkedAt: '2026-10-11T02:00:00.000Z',
          confirmed: {
            updated: 'x',
            days: { '2026-10-11': { 'GPV5.2': day({ 6: 'no' }) } },
          },
        }),
      ).expect(202);
      await send(
        okCheck({
          checkedAt: '2026-10-11T12:00:00.000Z',
          confirmed: {
            updated: 'y',
            days: { '2026-10-11': { 'GPV5.2': day() } },
          },
        }),
      ).expect(202);
      await send(
        okCheck({
          checkedAt: '2026-10-12T12:00:00.000Z',
          confirmed: {
            updated: 'z',
            days: { '2026-10-12': { 'GPV5.2': day() } },
          },
        }),
      ).expect(202);

      const [event] = await events();
      expect(event).toMatchObject({ withdrawnAt: null, revisedAt: null });
      expect(await prisma.outageEvent.count()).toBe(1);
    });

    it('keeps the events of a group the house is not on out', async () => {
      await send(
        okCheck({
          checkedAt: '2026-10-10T16:00:00.000Z',
          confirmed: {
            updated: 'x',
            days: { '2026-10-11': { 'GPV1.1': day({ 9: 'no' }) } },
          },
        }),
      ).expect(202);
      expect(await prisma.outageEvent.count()).toBe(0);
    });
  });

  it('turns away an unknown token', async () => {
    await send(okCheck(), 'nope').expect(401);
  });

  describe('refresh', () => {
    const refresh = () =>
      request(app.getHttpServer())
        .post(`/api/inverter/profiles/${profileId}/outage-source/refresh`)
        .set('Authorization', `Bearer ${admin}`);
    const asked = async () =>
      (
        await request(app.getHttpServer())
          .get('/api/outage/reader/source')
          .set('Authorization', `Bearer ${readerToken}`)
          .expect(200)
      ).body.refresh;

    it('asks the reader for a check now, until a check is stored', async () => {
      expect(await asked()).toBe(false);
      await refresh().expect(202);
      expect(await asked()).toBe(true);
      // Asking again while it waits changes nothing.
      await refresh().expect(202);

      await send(okCheck({ checkedAt: new Date().toISOString() })).expect(202);
      expect(await asked()).toBe(false);
    });

    it('allows one every 5 minutes', async () => {
      await send(
        okCheck({ checkedAt: new Date(Date.now() - 2 * 60_000).toISOString() }),
      ).expect(202);
      const { body } = await refresh().expect(429);
      expect(body.message).toMatch(/Checked 2 min ago; try again in 3 min/);

      await prisma.outageCheck.updateMany({
        data: { checkedAt: new Date(Date.now() - 6 * 60_000) },
      });
      await refresh().expect(202);
    });

    it('is refused while checking is switched off', async () => {
      await prisma.outageSource.updateMany({ data: { enabled: false } });
      await refresh().expect(409);
      expect(await asked()).toBe(false);
    });
  });
});
