import { LOCATION_DECIMALS } from './constants';

/** A coordinate as stored: rounded to LOCATION_DECIMALS; null stays null. */
export function roundCoordinate<T extends number | null | undefined>(
  value: T,
): T {
  if (typeof value !== 'number') return value;
  const factor = 10 ** LOCATION_DECIMALS;
  return (Math.round(value * factor) / factor) as T;
}
