import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramBot } from './telegram-bot';

const DEFAULT_TIME = '21:00';

/** The local date and HH:MM of `now` in `timeZone`. */
function localDateTime(
  now: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * The evening summary: the day's energy per inverter, sent to every linked
 * chat once a day at TELEGRAM_SUMMARY_TIME (HH:MM, default 21:00) in
 * TIME_ZONE.
 */
@Injectable()
export class TelegramSummary {
  private readonly logger = new Logger(TelegramSummary.name);
  private readonly time: string;
  private sentOn: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBot,
    config: ConfigService,
  ) {
    const configured = config.get<string>('TELEGRAM_SUMMARY_TIME') ?? '';
    this.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(configured)
      ? configured
      : DEFAULT_TIME;
  }

  @Interval(30_000)
  async tick(): Promise<void> {
    try {
      await this.sendIfDue(new Date());
    } catch (error) {
      this.logger.warn(
        `Evening summary failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Sends the summary when the local time has reached the set time and today's has not gone out. */
  async sendIfDue(now: Date): Promise<void> {
    const { date, time } = localDateTime(now, this.bot.timeZone);
    if (time < this.time || this.sentOn === date) return;
    this.sentOn = date;
    const links = await this.prisma.telegramLink.findMany({
      orderBy: { userId: 'asc' },
    });
    for (const link of links) {
      const lines = await this.bot.energyLines(link.userId, now);
      if (lines.length > 0)
        await this.bot.send(
          link.chatId,
          ['Evening summary', ...lines].join('\n'),
        );
    }
  }
}
