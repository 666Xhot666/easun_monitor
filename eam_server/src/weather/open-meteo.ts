import {
  DEFAULT_TILT_DEG,
  OPEN_METEO_URL,
  WEATHER_FORECAST_DAYS,
  WEATHER_PAST_DAYS,
  WEATHER_TIMEOUT_MS,
} from './constants';
import type { WeatherHour } from './expected-pv';

/** Where the panels are and how they are mounted. */
export interface Mounting {
  latitude: number;
  longitude: number;
  /** Tilt from flat, degrees; null: DEFAULT_TILT_DEG. */
  tiltDeg: number | null;
  /** Compass bearing faced (180 = south); null: towards the equator. */
  facingDeg: number | null;
}

type Series = (number | null)[];

interface Reply {
  hourly?: {
    time?: string[];
    global_tilted_irradiance?: Series;
    cloud_cover?: Series;
    temperature_2m?: Series;
  };
}

/** A compass bearing as Open-Meteo counts it: from south, -90 east, 90 west, 180 north. */
function fromSouth(bearing: number): number {
  const azimuth = bearing - 180;
  return azimuth <= -180 ? azimuth + 360 : azimuth;
}

/**
 * The hourly weather on the panel plane from Open-Meteo: the past
 * WEATHER_PAST_DAYS days, today and tomorrow, in local time of `timeZone`.
 */
export async function fetchWeather(
  mounting: Mounting,
  timeZone: string,
): Promise<WeatherHour[]> {
  const facing = mounting.facingDeg ?? (mounting.latitude >= 0 ? 180 : 0);
  const url = new URL(OPEN_METEO_URL);
  url.search = new URLSearchParams({
    latitude: String(mounting.latitude),
    longitude: String(mounting.longitude),
    hourly: 'global_tilted_irradiance,cloud_cover,temperature_2m',
    tilt: String(mounting.tiltDeg ?? DEFAULT_TILT_DEG),
    azimuth: String(fromSouth(facing)),
    timezone: timeZone,
    past_days: String(WEATHER_PAST_DAYS),
    forecast_days: String(WEATHER_FORECAST_DAYS),
  }).toString();

  const response = await fetch(url, {
    signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Open-Meteo answered ${response.status}`);
  }
  const { hourly } = (await response.json()) as Reply;
  const time = hourly?.time;
  const irradiance = hourly?.global_tilted_irradiance;
  const cloud = hourly?.cloud_cover;
  const temperature = hourly?.temperature_2m;
  if (
    !time ||
    irradiance?.length !== time.length ||
    cloud?.length !== time.length ||
    temperature?.length !== time.length
  ) {
    throw new Error('Open-Meteo sent an unexpected reply');
  }
  return time.map((t, i) => ({
    time: t,
    irradiance: irradiance[i],
    cloudCover: cloud[i],
    temperatureC: temperature[i],
  }));
}
