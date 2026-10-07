import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { BmsLatest } from '../src/bms/bms-latest';
import type { BmsReading } from '../src/bms/reading';
import { PrismaService } from '../src/prisma/prisma.service';
import { TelegramBot } from '../src/telegram/telegram-bot';
import { TELEGRAM_CLIENT } from '../src/telegram/telegram-client';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';
import { FakeTelegram } from './support/fake-telegram';

const CHAT = 4242;
const message = (text: string, chatId = CHAT) => ({
  update_id: 1,
  message: { chat: { id: chatId }, text },
});
const press = (data: string, messageId = 77, chatId = CHAT) => ({
  update_id: 2,
  callback_query: {
    id: `cb-${data}`,
    data,
    message: { message_id: messageId, chat: { id: chatId } },
  },
});

describe('Telegram views (e2e)', () => {
  let app: INestApplication<App>;
  let telegram: FakeTelegram;
  let bot: TelegramBot;
  let profile: { id: number; name: string };

  beforeAll(async () => {
    telegram = new FakeTelegram();
    app = await createTestApp((builder) =>
      builder.overrideProvider(TELEGRAM_CLIENT).useValue(telegram),
    );
    bot = app.get(TelegramBot);
    const prisma = app.get(PrismaService);
    await resetDatabase(app);
    const token = await registerUser(app, 'owner@example.com');
    profile = (
      await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${token}`)
        .send(sampleProfile)
        .expect(201)
    ).body;
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'owner@example.com' },
    });
    await prisma.telegramLink.create({
      data: { chatId: String(CHAT), userId: owner.id },
    });
    await prisma.inverterLog.create({
      data: {
        inverterProfileId: profile.id,
        payload: {
          OperationMode: 3,
          PVPower: 500,
          BatterySoc: 77,
          BatteryVoltage: 26,
          BatteryCurrentSigned: 5,
          FaultCode: 0,
          WarningCode: 0,
        },
      },
    });
    const device = await prisma.bmsDevice.create({
      data: {
        name: 'Pack',
        sourceType: 'mac-ble',
        tokenHash: 'h',
        inverterProfileId: profile.id,
      },
    });
    app.get(BmsLatest).set(device.id, {
      timestamp: new Date().toISOString(),
      packVoltageV: 26.1,
      currentA: 5,
      powerW: 130.5,
      stateOfChargePct: 76,
      cellVoltagesV: [],
      cellMinV: null,
      cellMaxV: null,
      cellDeltaV: null,
      temperaturesC: [],
      alarms: [],
    } as unknown as BmsReading);
  });

  afterAll(() => app.close());
  beforeEach(() => {
    telegram.sent = [];
    telegram.answered = [];
  });

  /** Every button's data, row by row flattened. */
  const buttonData = (i = 0) =>
    telegram.sent[i].options?.buttons?.flat().map((b) => b.data);

  it('registers the command menu', async () => {
    await bot.registerCommands();

    expect(telegram.commands.map((c) => c.command)).toEqual([
      'status',
      'battery',
      'faults',
      'energy',
      'week',
      'stop',
    ]);
    expect(telegram.commands.every((c) => c.description.length > 0)).toBe(true);
  });

  it('sends /status as an HTML card with buttons for the other views and a refresh', async () => {
    await bot.handleUpdate(message('/status'));

    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0].text).toMatch(
      new RegExp(`^<b>🏠 ${profile.name}</b> · Off-grid`),
    );
    expect(telegram.sent[0].options?.html).toBe(true);
    expect(buttonData()).toEqual([
      'v:status',
      'v:battery',
      'v:faults',
      'v:energy',
      'v:week',
      'v:status',
    ]);
    expect(telegram.sent[0].options?.buttons?.at(-1)?.[0].text).toBe(
      '🔄 Refresh',
    );
  });

  it('switches the same message to another view when a button is pressed', async () => {
    await bot.handleUpdate(press('v:battery'));

    expect(telegram.answered).toEqual(['cb-v:battery']);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0].editedMessageId).toBe(77);
    expect(telegram.sent[0].text).toContain(`<b>🔋 ${profile.name}</b>`);
    expect(telegram.sent[0].text).toContain('<b>BMS Pack</b>');
    expect(telegram.sent[0].text).toContain(
      '<b>76 %</b> · 26.10 V · 5.0 A · 131 W',
    );
    // Refresh now re-renders the battery view.
    expect(buttonData()?.at(-1)).toBe('v:battery');
  });

  it('answers /faults and /week', async () => {
    await bot.handleUpdate(message('/faults'));
    await bot.handleUpdate(message('/week'));

    expect(telegram.sent[0].text).toBe(
      `<b>🚨 ${profile.name}</b> · Off-grid\n✅ No faults or warnings`,
    );
    expect(telegram.sent[1].text).toMatch(
      new RegExp(`^<b>📅 ${profile.name} · kWh by day</b>\n<pre>\nDay `),
    );
    // 7 days and the total.
    expect(
      telegram.sent[1].text.split('\n').filter((line) => /^\S.*\d$/.test(line)),
    ).toHaveLength(8);
  });

  it('asks an unlinked chat to link first when it presses a button', async () => {
    await bot.handleUpdate(press('v:status', 5, 999));

    expect(telegram.answered).toEqual(['cb-v:status']);
    expect(telegram.sent).toEqual([
      expect.objectContaining({
        chatId: '999',
        text: expect.stringMatching(/open Household/),
      }),
    ]);
  });

  it('only acknowledges a button it does not know', async () => {
    await bot.handleUpdate(press('v:nope'));

    expect(telegram.answered).toEqual(['cb-v:nope']);
    expect(telegram.sent).toEqual([]);
  });
});
