import {
  PERFORMANCE_RATIO,
  STC_IRRADIANCE_W_M2,
  STC_CELL_TEMP_C,
  CELL_HEATING_C_PER_W_M2,
  POWER_TEMP_COEFF_PER_C,
} from './constants';

/** One hour of weather on the panel plane. */
export interface WeatherHour {
  /** Local time of the hour's end, 'YYYY-MM-DDTHH:MM'. */
  time: string;
  /** Mean irradiance on the panels over the preceding hour, W/m². */
  irradiance: number | null;
  cloudCover: number | null;
  temperatureC: number | null;
}

export interface ArrayRating {
  /** Rated array power at standard test conditions, W. */
  powerW: number;
  /** The inverter's PV input limit, W, or null. */
  maxInputW: number | null;
}

/** The power the array should give in that hour's weather, W. */
export function expectedPowerW(
  hour: WeatherHour,
  array: ArrayRating,
): number | null {
  const irradiance = hour.irradiance;
  if (irradiance === null) {
    return null;
  }
  if (irradiance <= 0) {
    return 0;
  }
  const ambient = hour.temperatureC ?? STC_CELL_TEMP_C;
  const cellTemp = ambient + irradiance * CELL_HEATING_C_PER_W_M2;
  const factor = Math.max(
    0,
    1 + POWER_TEMP_COEFF_PER_C * (cellTemp - STC_CELL_TEMP_C),
  );
  let power =
    array.powerW *
    (irradiance / STC_IRRADIANCE_W_M2) *
    PERFORMANCE_RATIO *
    factor;
  if (array.maxInputW !== null) {
    power = Math.min(power, array.maxInputW);
  }
  return Math.round(power);
}

export interface ExpectedDay {
  /** Local date 'YYYY-MM-DD'. */
  date: string;
  /** Expected energy, kWh; null when any daylight hour's irradiance is missing. */
  expectedKWh: number | null;
  /** Mean cloud cover over the hours with irradiance > 0, %, or null when none. */
  cloudCover: number | null;
}

/** Each local day's expected energy, in date order. */
export function expectedDays(
  hours: readonly WeatherHour[],
  array: ArrayRating,
): ExpectedDay[] {
  const byDate = new Map<string, WeatherHour[]>();
  for (const hour of hours) {
    const date = hour.time.slice(0, 10);
    const list = byDate.get(date);
    if (list === undefined) {
      byDate.set(date, [hour]);
    } else {
      list.push(hour);
    }
  }
  const dates = Array.from(byDate.keys()).sort();
  const result: ExpectedDay[] = [];
  for (const date of dates) {
    const dayHours = byDate.get(date) ?? [];
    let missing = false;
    let totalKWh = 0;
    let cloudSum = 0;
    let cloudCount = 0;
    for (const hour of dayHours) {
      const power = expectedPowerW(hour, array);
      if (power === null) {
        missing = true;
      } else {
        totalKWh += power / 1000;
      }
      if (hour.irradiance !== null && hour.irradiance > 0) {
        if (hour.cloudCover !== null) {
          cloudSum += hour.cloudCover;
          cloudCount += 1;
        }
      }
    }
    const expectedKWh = missing ? null : Math.round(totalKWh * 100) / 100;
    const cloudCover =
      cloudCount === 0 ? null : Math.round(cloudSum / cloudCount);
    result.push({ date, expectedKWh, cloudCover });
  }
  return result;
}
