import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TELEGRAM_CLIENT,
  type BotCommand,
  type MessageOptions,
  type TelegramClient,
  type TelegramUpdate,
} from './telegram-client';
import { TelegramLinksService } from './telegram-links.service';
import { HouseholdsService } from '../households/households.service';
import { RegisterMap } from '../inverter/registers/register-map';
import { SMG_II_REGISTERS } from '../inverter/registers/smg-ii.registers';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryStore } from '../telemetry/telemetry.store';
import type { BmsReading } from '../bms/reading';
import { BmsLatest } from '../bms/bms-latest';
import {
  batteryCard,
  energyCard,
  faultsCard,
  statusCard,
  weekCard,
} from './cards';
import { powerChartSvg, svgToPng } from './chart';
import { dayStart, formatEnergy } from './messages';

const POLL_TIMEOUT_SECONDS = 30;
const RETRY_AFTER_ERROR_MS = 5_000;

const HOW_TO_LINK =
  'To link this chat, open Household in the app, get a Telegram code, and send it here as /start <code>.';
type ViewName = 'status' | 'battery' | 'faults' | 'energy' | 'week';

/** The views a command or a button shows, in menu order. */
const VIEWS: { name: ViewName; button: string; description: string }[] = [
  {
    name: 'status',
    button: '🏠 Status',
    description: 'Mode, power flow and battery now',
  },
  {
    name: 'battery',
    button: '🔋 Battery',
    description: 'Battery and BMS detail: cells, temperatures, alarms',
  },
  {
    name: 'faults',
    button: '🚨 Faults',
    description: 'Active faults and warnings',
  },
  { name: 'energy', button: '⚡ Today', description: "Today's energy" },
  {
    name: 'week',
    button: '📅 Week',
    description: 'Energy by day, last 7 days',
  },
];

const MENU: BotCommand[] = [
  ...VIEWS.map((v) => ({ command: v.name, description: v.description })),
  { command: 'chart', description: 'Power chart of the last 24 hours' },
  { command: 'stop', description: 'Unlink this chat' },
];

const HELP = `Commands: ${MENU.map((c) => `/${c.command}`).join(', ')}.`;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The Telegram bot: long-polls for messages (no public address needed) and
 * answers them. Runs only when TELEGRAM_BOT_TOKEN is set.
 */
@Injectable()
export class TelegramBot
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramBot.name);
  private running = false;
  private readonly map = new RegisterMap(SMG_II_REGISTERS);

  constructor(
    @Inject(TELEGRAM_CLIENT) private readonly client: TelegramClient | null,
    private readonly links: TelegramLinksService,
    private readonly config: ConfigService,
    private readonly households: HouseholdsService,
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryStore,
    private readonly bmsLatest: BmsLatest,
  ) {}

  /** The IANA time zone that defines "today" (TIME_ZONE, default UTC). */
  get timeZone(): string {
    return this.config.get<string>('TIME_ZONE') || 'UTC';
  }

  onApplicationBootstrap(): void {
    if (!this.client || !this.config.get<string>('TELEGRAM_BOT_TOKEN')) return;
    this.running = true;
    this.registerCommands().catch((error: unknown) => {
      this.logger.warn(`Setting the command menu failed: ${errorText(error)}`);
    });
    void this.poll();
  }

  onApplicationShutdown(): void {
    this.running = false;
  }

  /** Fills the "/" command menu in Telegram. */
  async registerCommands(): Promise<void> {
    await this.client?.setCommands(MENU);
  }

  /** Sends a message to a chat; failures are logged, never thrown. */
  async send(
    chatId: string,
    text: string,
    options?: MessageOptions,
  ): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.sendMessage(chatId, text, options);
    } catch (error) {
      this.logger.warn(`Sending to chat ${chatId} failed: ${errorText(error)}`);
    }
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) return this.handlePress(update.callback_query);
    const text = update.message?.text?.trim();
    const id = update.message?.chat.id;
    if (!text || id === undefined) return;
    const chatId = String(id);
    // "/status@MyBot" in groups: drop the bot name.
    const [rawCommand, argument] = text.split(/\s+/, 2);
    const command = rawCommand.replace(/@.*$/, '');

    if (command === '/start' && argument) {
      const linked = await this.links.linkChat(argument, chatId);
      await this.send(
        chatId,
        linked
          ? `Linked to ${linked.email}. Alerts and the evening summary will come here. ${HELP}`
          : `This code is not valid; codes expire after 10 minutes. ${HOW_TO_LINK}`,
      );
      return;
    }
    if (command === '/stop') {
      await this.links.unlinkChat(chatId);
      await this.send(chatId, `This chat is unlinked. ${HOW_TO_LINK}`);
      return;
    }
    const userId = await this.links.userForChat(chatId);
    if (userId === null) {
      await this.send(chatId, HOW_TO_LINK);
      return;
    }
    const view = VIEWS.find((v) => `/${v.name}` === command);
    if (command === '/chart') {
      await this.sendCharts(chatId, userId);
    } else if (view) {
      await this.send(
        chatId,
        await this.render(view.name, userId),
        this.viewOptions(view.name),
      );
    } else {
      await this.send(chatId, HELP);
    }
  }

  /** A button press: switch the message it is on to the chosen view. */
  private async handlePress(
    press: NonNullable<TelegramUpdate['callback_query']>,
  ): Promise<void> {
    await this.client?.answerCallback(press.id).catch((error: unknown) => {
      this.logger.warn(`Answering a button press failed: ${errorText(error)}`);
    });
    const message = press.message;
    const view = VIEWS.find((v) => `v:${v.name}` === press.data);
    const chart = press.data === 'chart';
    if (!message || (!view && !chart)) return;
    const chatId = String(message.chat.id);
    const userId = await this.links.userForChat(chatId);
    if (userId === null) {
      await this.send(chatId, HOW_TO_LINK);
      return;
    }
    // A photo can't replace a text message: the chart comes as a new one.
    if (!view) return this.sendCharts(chatId, userId);
    try {
      await this.client?.editMessage(
        chatId,
        message.message_id,
        await this.render(view.name, userId),
        this.viewOptions(view.name),
      );
    } catch (error) {
      this.logger.warn(
        `Updating a message in chat ${chatId} failed: ${errorText(error)}`,
      );
    }
  }

  /** HTML, with buttons for every view and a refresh of this one. */
  private viewOptions(current: ViewName): MessageOptions {
    const button = (name: ViewName) => {
      const view = VIEWS.find((v) => v.name === name)!;
      return { text: view.button, data: `v:${name}` };
    };
    return {
      html: true,
      buttons: [
        [button('status'), button('battery'), button('faults')],
        [button('energy'), button('week'), { text: '📈 Chart', data: 'chart' }],
        [{ text: '🔄 Refresh', data: `v:${current}` }],
      ],
    };
  }

  /** One card per inverter of the user's households. */
  private async render(view: ViewName, userId: number): Promise<string> {
    const profiles = await this.profilesOf(userId);
    if (profiles.length === 0) return 'No inverters in your households yet.';
    const now = new Date();
    const cards = await Promise.all(
      profiles.map((p) => this.card(view, p, now)),
    );
    return cards.join('\n\n');
  }

  private async card(
    view: ViewName,
    profile: { id: number; name: string },
    now: Date,
  ): Promise<string> {
    if (view === 'energy')
      return energyCard(
        profile.name,
        await this.energyOn(profile.id, dayStart(now, this.timeZone)),
      );
    if (view === 'week')
      return weekCard(profile.name, await this.week(profile.id, now));
    const latest = await this.telemetry.latest(profile.id);
    const payload = latest ? (latest.payload as Record<string, number>) : null;
    if (view === 'faults') return faultsCard(profile.name, this.map, payload);
    if (view === 'battery')
      return batteryCard(
        profile.name,
        payload,
        await this.bmsOf(profile.id),
        now,
      );
    return statusCard(
      profile.name,
      this.map,
      latest && payload ? { timestamp: latest.timestamp, payload } : null,
      now,
    );
  }

  /** A power chart of the last 24 hours, one photo per inverter. */
  private async sendCharts(chatId: string, userId: number): Promise<void> {
    const profiles = await this.profilesOf(userId);
    if (profiles.length === 0) {
      await this.send(chatId, 'No inverters in your households yet.');
      return;
    }
    const to = Date.now();
    const from = to - 24 * 3_600_000;
    for (const profile of profiles) {
      try {
        const history = await this.telemetry.history(profile.id, {
          from: new Date(from),
          to: new Date(to),
          maxPoints: 288,
          fields: [
            'PVPower',
            'OutputActivePower',
            'AverageMainsPower',
            'BatteryVoltage',
            'BatteryCurrentSigned',
          ],
        });
        const series = (
          value: (v: Record<string, number>) => number | undefined,
        ) =>
          history.points.flatMap((p) => {
            const v = value(p.values);
            return v === undefined ? [] : [{ t: Date.parse(p.timestamp), v }];
          });
        const svg = powerChartSvg(
          `${profile.name} · last 24 h`,
          [
            { label: 'PV', color: '#f59e0b', points: series((v) => v.PVPower) },
            {
              label: 'Load',
              color: '#3b82f6',
              points: series((v) => v.OutputActivePower),
            },
            {
              label: 'Grid',
              color: '#6b7280',
              points: series((v) => v.AverageMainsPower),
            },
            {
              label: 'Battery (+charge)',
              color: '#10b981',
              points: series((v) =>
                v.BatteryVoltage === undefined ||
                v.BatteryCurrentSigned === undefined
                  ? undefined
                  : v.BatteryVoltage * v.BatteryCurrentSigned,
              ),
            },
          ],
          // Up to three missed buckets still draw as one line.
          {
            from,
            to,
            timeZone: this.timeZone,
            maxGapMs: Math.max(3 * history.bucketSeconds * 1000, 15 * 60_000),
          },
        );
        await this.client?.sendPhoto(
          chatId,
          svgToPng(svg),
          `${profile.name} · last 24 h`,
        );
      } catch (error) {
        this.logger.warn(
          `Sending a chart to chat ${chatId} failed: ${errorText(error)}`,
        );
      }
    }
  }

  /** The profile's BMS devices with their newest reading. */
  private async bmsOf(profileId: number) {
    const devices = await this.prisma.bmsDevice.findMany({
      where: { inverterProfileId: profileId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    const withReadings = await Promise.all(
      devices.map(async (d) => {
        const live = this.bmsLatest.get(d.id)?.reading;
        const stored = live
          ? null
          : await this.prisma.bmsLog.findFirst({
              where: { bmsDeviceId: d.id },
              orderBy: { timestamp: 'desc' },
            });
        const reading =
          live ?? (stored?.payload as unknown as BmsReading | undefined);
        return reading ? { name: d.name, reading } : null;
      }),
    );
    return withReadings.filter((d) => d !== null);
  }

  private energyOn(profileId: number, from: Date) {
    return this.telemetry.energy(profileId, {
      from,
      to: new Date(from.getTime() + 24 * 3_600_000),
    });
  }

  /** Today and the 6 days before it, newest first. */
  private async week(profileId: number, now: Date) {
    const starts: Date[] = [dayStart(now, this.timeZone)];
    while (starts.length < 7)
      starts.push(
        dayStart(new Date(starts.at(-1)!.getTime() - 1), this.timeZone),
      );
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timeZone,
      weekday: 'short',
      day: '2-digit',
    });
    return Promise.all(
      starts.map(async (from) => ({
        label: label.format(from),
        totals: await this.energyOn(profileId, from),
      })),
    );
  }

  /** The inverters of all the user's households. */
  private async profilesOf(userId: number) {
    return this.prisma.inverterProfile.findMany({
      where: {
        householdId: { in: await this.households.householdIds(userId) },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  /** The day's energy so far, one line per inverter of the user's households. */
  async energyLines(userId: number, now: Date): Promise<string[]> {
    const profiles = await this.profilesOf(userId);
    const from = dayStart(now, this.timeZone);
    const to = new Date(from.getTime() + 24 * 3_600_000);
    return Promise.all(
      profiles.map(async (p) =>
        formatEnergy(p.name, await this.telemetry.energy(p.id, { from, to })),
      ),
    );
  }

  private async poll(): Promise<void> {
    let offset = 0;
    while (this.running && this.client) {
      try {
        const updates = await this.client.getUpdates(
          offset,
          POLL_TIMEOUT_SECONDS,
        );
        for (const update of updates) {
          offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        this.logger.warn(
          `Telegram polling failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_AFTER_ERROR_MS),
        );
      }
    }
  }
}
