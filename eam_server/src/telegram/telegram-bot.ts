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
  type TelegramUser,
} from './telegram-client';
import { TelegramLinksService } from './telegram-links.service';
import { HouseholdsService } from '../households/households.service';
import { LOCALES, type Language } from '../i18n/languages';
import { translate } from '../i18n/translate';
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
import { dayStart, formatEnergy, formatTomorrow } from './messages';
import { WeatherService } from '../weather/weather.service';

const POLL_TIMEOUT_SECONDS = 30;
const RETRY_AFTER_ERROR_MS = 5_000;

type ViewName = 'status' | 'battery' | 'faults' | 'energy' | 'week';

/** The views a command or a button shows, in menu order. */
const VIEWS: ViewName[] = ['status', 'battery', 'faults', 'energy', 'week'];

/** The "/" menu in `language`. */
const menu = (language: Language): BotCommand[] => [
  ...VIEWS.map((name) => ({
    command: name,
    description: translate(language, `telegram.views.${name}.description`),
  })),
  {
    command: 'chart',
    description: translate(language, 'telegram.chartCommand'),
  },
  { command: 'stop', description: translate(language, 'telegram.stopCommand') },
];

const help = (language: Language) =>
  translate(language, 'telegram.help', {
    commands: menu(language)
      .map((c) => `/${c.command}`)
      .join(', '),
  });

const howToLink = (language: Language) =>
  translate(language, 'telegram.howToLink');

/** The language of a Telegram app: Ukrainian if it is in Ukrainian, else English. */
const appLanguage = (user?: TelegramUser): Language =>
  user?.language_code?.startsWith('uk') ? 'uk' : 'en';

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

  constructor(
    @Inject(TELEGRAM_CLIENT) private readonly client: TelegramClient | null,
    private readonly links: TelegramLinksService,
    private readonly config: ConfigService,
    private readonly households: HouseholdsService,
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryStore,
    private readonly bmsLatest: BmsLatest,
    private readonly weather: WeatherService,
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

  /** Fills the "/" command menu in Telegram: English, and Ukrainian for apps in Ukrainian. */
  async registerCommands(): Promise<void> {
    await this.client?.setCommands(menu('en'));
    await this.client?.setCommands(menu('uk'), 'uk');
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
    const app = appLanguage(update.message?.from);
    // "/status@MyBot" in groups: drop the bot name.
    const [rawCommand, argument] = text.split(/\s+/, 2);
    const command = rawCommand.replace(/@.*$/, '');

    if (command === '/start' && argument) {
      const linked = await this.links.linkChat(argument, chatId);
      const language = linked
        ? ((await this.links.accountForChat(chatId))?.language ?? app)
        : app;
      await this.send(
        chatId,
        linked
          ? translate(language, 'telegram.linked', {
              email: linked.email,
              help: help(language),
            })
          : translate(language, 'telegram.badCode', {
              howToLink: howToLink(language),
            }),
      );
      return;
    }
    if (command === '/stop') {
      const language =
        (await this.links.accountForChat(chatId))?.language ?? app;
      await this.links.unlinkChat(chatId);
      await this.send(
        chatId,
        translate(language, 'telegram.unlinked', {
          howToLink: howToLink(language),
        }),
      );
      return;
    }
    const account = await this.links.accountForChat(chatId);
    if (account === null) {
      await this.send(chatId, howToLink(app));
      return;
    }
    const { userId } = account;
    const language = account.language ?? app;
    const view = VIEWS.find((name) => `/${name}` === command);
    if (command === '/chart') {
      await this.sendCharts(chatId, userId, language);
    } else if (view) {
      await this.send(
        chatId,
        await this.render(view, userId, language),
        this.viewOptions(view, language),
      );
    } else {
      await this.send(chatId, help(language));
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
    const view = VIEWS.find((name) => `v:${name}` === press.data);
    const chart = press.data === 'chart';
    if (!message || (!view && !chart)) return;
    const chatId = String(message.chat.id);
    const app = appLanguage(press.from);
    const account = await this.links.accountForChat(chatId);
    if (account === null) {
      await this.send(chatId, howToLink(app));
      return;
    }
    const { userId } = account;
    const language = account.language ?? app;
    // A photo can't replace a text message: the chart comes as a new one.
    if (!view) return this.sendCharts(chatId, userId, language);
    try {
      await this.client?.editMessage(
        chatId,
        message.message_id,
        await this.render(view, userId, language),
        this.viewOptions(view, language),
      );
    } catch (error) {
      this.logger.warn(
        `Updating a message in chat ${chatId} failed: ${errorText(error)}`,
      );
    }
  }

  /** HTML, with buttons for every view and a refresh of this one. */
  private viewOptions(current: ViewName, language: Language): MessageOptions {
    const t = (key: string) => translate(language, `telegram.${key}`);
    const button = (name: ViewName) => ({
      text: t(`views.${name}.button`),
      data: `v:${name}`,
    });
    return {
      html: true,
      buttons: [
        [button('status'), button('battery'), button('faults')],
        [
          button('energy'),
          button('week'),
          { text: t('chartButton'), data: 'chart' },
        ],
        [{ text: t('refreshButton'), data: `v:${current}` }],
      ],
    };
  }

  /** One card per inverter of the user's households. */
  private async render(
    view: ViewName,
    userId: number,
    language: Language,
  ): Promise<string> {
    const profiles = await this.profilesOf(userId);
    if (profiles.length === 0)
      return translate(language, 'telegram.noInverters');
    const now = new Date();
    const cards = await Promise.all(
      profiles.map((p) => this.card(view, p, now, language)),
    );
    return cards.join('\n\n');
  }

  private async card(
    view: ViewName,
    profile: { id: number; name: string },
    now: Date,
    language: Language,
  ): Promise<string> {
    if (view === 'energy')
      return energyCard(
        profile.name,
        await this.energyOn(profile.id, dayStart(now, this.timeZone)),
        language,
      );
    if (view === 'week')
      return weekCard(
        profile.name,
        await this.week(profile.id, now, language),
        language,
      );
    const latest = await this.telemetry.latest(profile.id);
    const payload = latest ? (latest.payload as Record<string, number>) : null;
    if (view === 'faults') return faultsCard(profile.name, payload, language);
    if (view === 'battery')
      return batteryCard(
        profile.name,
        payload,
        await this.bmsOf(profile.id),
        now,
        language,
      );
    return statusCard(
      profile.name,
      latest && payload ? { timestamp: latest.timestamp, payload } : null,
      now,
      language,
    );
  }

  /** A power chart of the last 24 hours, one photo per inverter. */
  private async sendCharts(
    chatId: string,
    userId: number,
    language: Language,
  ): Promise<void> {
    const t = (key: string, values?: Record<string, string>) =>
      translate(language, `telegram.${key}`, values);
    const profiles = await this.profilesOf(userId);
    if (profiles.length === 0) {
      await this.send(chatId, t('noInverters'));
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
        const title = t('chart.title', { name: profile.name });
        const svg = powerChartSvg(
          title,
          [
            {
              label: t('chart.pv'),
              color: '#f59e0b',
              points: series((v) => v.PVPower),
            },
            {
              label: t('chart.load'),
              color: '#3b82f6',
              points: series((v) => v.OutputActivePower),
            },
            {
              label: t('chart.grid'),
              color: '#6b7280',
              points: series((v) => v.AverageMainsPower),
            },
            {
              label: t('chart.battery'),
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
            language,
            maxGapMs: Math.max(3 * history.bucketSeconds * 1000, 15 * 60_000),
          },
        );
        await this.client?.sendPhoto(chatId, svgToPng(svg), title);
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
  private async week(profileId: number, now: Date, language: Language) {
    const starts: Date[] = [dayStart(now, this.timeZone)];
    while (starts.length < 7)
      starts.push(
        dayStart(new Date(starts.at(-1)!.getTime() - 1), this.timeZone),
      );
    const label = new Intl.DateTimeFormat(LOCALES[language], {
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
  async energyLines(
    userId: number,
    now: Date,
    language: Language,
  ): Promise<string[]> {
    const profiles = await this.profilesOf(userId);
    const from = dayStart(now, this.timeZone);
    const to = new Date(from.getTime() + 24 * 3_600_000);
    const lines = await Promise.all(
      profiles.map(async (p) => {
        const energy = formatEnergy(
          p.name,
          await this.telemetry.energy(p.id, { from, to }),
          language,
        );
        const tomorrow = await this.tomorrow(p.id, now);
        return tomorrow
          ? [energy, formatTomorrow(tomorrow, language)]
          : [energy];
      }),
    );
    return lines.flat();
  }

  /** Tomorrow's expected PV, or null without a forecast (no location, no array, source down). */
  private async tomorrow(
    profileId: number,
    now: Date,
  ): Promise<{ expectedKWh: number; cloudCover: number | null } | null> {
    try {
      const { days } = await this.weather.solarForecast(profileId, now);
      const today = dayStart(now, this.timeZone);
      const next = days.find(
        (d) => dayStart(new Date(`${d.date}T12:00:00Z`), this.timeZone) > today,
      );
      return next?.expectedKWh == null
        ? null
        : { expectedKWh: next.expectedKWh, cloudCover: next.cloudCover };
    } catch {
      return null;
    }
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
