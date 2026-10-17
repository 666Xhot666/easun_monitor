import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { localized } from '../i18n/localized';
import { PrismaService } from '../prisma/prisma.service';
import { dayStart } from '../telegram/messages';
import { TelemetryStore } from '../telemetry/telemetry.store';
import { WEATHER_CACHE_MS } from './constants';
import {
  expectedDays,
  expectedPowerW,
  type ArrayRating,
  type WeatherHour,
} from './expected-pv';
import { fetchWeather, type Mounting } from './open-meteo';

export interface ForecastDay {
  date: string;
  expectedKWh: number | null;
  /** What the array made that day, kWh; null for days ahead or without readings. */
  actualKWh: number | null;
  cloudCover: number | null;
}

export interface ForecastHour {
  time: string;
  expectedW: number | null;
  cloudCover: number | null;
}

export interface SolarForecast {
  /** The past week, today and tomorrow. */
  days: ForecastDay[];
  /** Today's and tomorrow's hours. */
  hours: ForecastHour[];
  /** True when the tilt or facing is not set and a default was used. */
  assumedMounting: boolean;
}

interface Cached {
  key: string;
  at: number;
  hours: WeatherHour[];
}

/** The local date of `at` in `timeZone`, YYYY-MM-DD. */
function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
}

/** Local midnight starting `date` (YYYY-MM-DD) in `timeZone`. */
function startOf(date: string, timeZone: string): Date {
  return dayStart(new Date(`${date}T12:00:00Z`), timeZone);
}

/** How much PV the weather allows each day, and what the array made. */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly cache = new Map<number, Cached>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryStore,
    private readonly config: ConfigService,
  ) {}

  private get timeZone(): string {
    return this.config.get<string>('TIME_ZONE') || 'UTC';
  }

  async solarForecast(profileId: number, now: Date): Promise<SolarForecast> {
    const profile = await this.prisma.inverterProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: { pvPanelType: true },
    });
    const { latitude, longitude, pvPanelType: panel } = profile;
    if (latitude === null || longitude === null) {
      throw new ConflictException(localized('weatherNeedsLocation'));
    }
    if (!panel || !profile.pvPanelsInSeries || !profile.pvStrings) {
      throw new ConflictException(localized('weatherNeedsArray'));
    }
    const array: ArrayRating = {
      powerW: panel.maxPowerW * profile.pvPanelsInSeries * profile.pvStrings,
      maxInputW: profile.pvMaxPowerW,
    };
    const mounting: Mounting = {
      latitude,
      longitude,
      tiltDeg: profile.pvTiltDeg,
      facingDeg: profile.pvFacingDeg,
    };

    const hours = await this.weather(profileId, mounting, now);
    const today = localDate(now, this.timeZone);
    const days = await Promise.all(
      expectedDays(hours, array).map(async (day) => ({
        date: day.date,
        expectedKWh: day.expectedKWh,
        actualKWh:
          day.date <= today ? await this.actual(profileId, day.date) : null,
        cloudCover: day.cloudCover,
      })),
    );
    return {
      days,
      hours: hours
        .filter((h) => h.time.slice(0, 10) >= today)
        .map((h) => ({
          time: h.time,
          expectedW: expectedPowerW(h, array),
          cloudCover: h.cloudCover,
        })),
      assumedMounting: mounting.tiltDeg === null || mounting.facingDeg === null,
    };
  }

  /** The weather, from the cache while it is fresh and the mounting unchanged. */
  private async weather(
    profileId: number,
    mounting: Mounting,
    now: Date,
  ): Promise<WeatherHour[]> {
    const key = JSON.stringify(mounting);
    const cached = this.cache.get(profileId);
    if (cached?.key === key && now.getTime() - cached.at < WEATHER_CACHE_MS) {
      return cached.hours;
    }
    const hours = await fetchWeather(mounting, this.timeZone).catch(
      (error: unknown) => {
        this.logger.warn(
          `Weather unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw new ServiceUnavailableException(localized('weatherUnavailable'));
      },
    );
    this.cache.set(profileId, { key, at: now.getTime(), hours });
    return hours;
  }

  private async actual(
    profileId: number,
    date: string,
  ): Promise<number | null> {
    const from = startOf(date, this.timeZone);
    const to = new Date(from.getTime() + 36 * 3_600_000);
    const energy = await this.telemetry.energy(profileId, {
      from,
      to: startOf(localDate(to, this.timeZone), this.timeZone),
    });
    if (energy.coveredSeconds === 0) return null;
    return Math.round(energy.pvKWh * 100) / 100;
  }
}
