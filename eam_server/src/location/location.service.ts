import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { localized } from '../i18n/localized';
import { LOCATION_LOOKUP_TIMEOUT_MS, LOCATION_LOOKUP_URL } from './constants';
import { roundCoordinate } from './round-location';

export interface Location {
  latitude: number;
  longitude: number;
}

/** Finds roughly where the installation is, when the user asks for it. */
@Injectable()
export class LocationService {
  /** The server's location by its public address; nothing is stored. */
  async detect(): Promise<Location> {
    const found = await this.lookUp().catch(() => null);
    if (!found) {
      throw new ServiceUnavailableException(localized('locationUnavailable'));
    }
    return {
      latitude: roundCoordinate(found.latitude),
      longitude: roundCoordinate(found.longitude),
    };
  }

  private async lookUp(): Promise<Location | null> {
    const response = await fetch(LOCATION_LOOKUP_URL, {
      signal: AbortSignal.timeout(LOCATION_LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<Record<string, unknown>>;
    const { latitude, longitude } = body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return null;
    }
    return { latitude, longitude };
  }
}
