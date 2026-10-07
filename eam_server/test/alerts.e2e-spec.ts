import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelegramAlerts } from '../src/telegram/telegram-alerts';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

describe('Alert history (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alerts: TelegramAlerts;
  let owner: string;
  let stranger: string;
  let profileId: number;

  beforeAll(async () => {
    // No Telegram client and no linked chats: alerts are still recorded.
    app = await createTestApp();
    prisma = app.get(PrismaService);
    alerts = app.get(TelegramAlerts);
    await resetDatabase(app);
    owner = await registerUser(app, 'owner@example.com');
    stranger = await registerUser(app, 'stranger@example.com');
    profileId = (
      await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${owner}`)
        .send(sampleProfile)
        .expect(201)
    ).body.id;
  });

  afterAll(() => app.close());

  it('records each alert as it is detected, with its kind', async () => {
    await alerts.onReading(profileId, { MainsVoltage: 230 });
    await alerts.onReading(profileId, { MainsVoltage: 0 });
    await alerts.onReading(profileId, { MainsVoltage: 231 });

    const rows = await prisma.alertEvent.findMany({
      where: { inverterProfileId: profileId },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((r) => [r.kind, r.text])).toEqual([
      ['grid', 'Grid lost'],
      ['grid', 'Grid restored'],
    ]);
  });

  it("lists an inverter's alerts newest first, a page at a time", async () => {
    const page = await request(app.getHttpServer())
      .get(`/api/inverter/${profileId}/alerts`)
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(page.body).toEqual([
      expect.objectContaining({
        kind: 'grid',
        text: 'Grid restored',
        source: null,
      }),
    ]);
    expect(typeof page.body[0].at).toBe('string');

    const next = await request(app.getHttpServer())
      .get(`/api/inverter/${profileId}/alerts`)
      .query({ limit: 1, before: page.body[0].id })
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(next.body.map((a: { text: string }) => a.text)).toEqual([
      'Grid lost',
    ]);
  });

  it("keeps an inverter's alerts from other households", async () => {
    await request(app.getHttpServer())
      .get(`/api/inverter/${profileId}/alerts`)
      .set('Authorization', `Bearer ${stranger}`)
      .expect((res) => expect([403, 404]).toContain(res.status));
  });
});
