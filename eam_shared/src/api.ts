import type { AuthUser, InverterProfile } from './auth';
import type { EnergyTotals } from './energy';
import type { History } from './history';
import type { LatestReading } from './inverter';
import type { CommonReading } from './readings';

/** The part of an HTTP client the API needs; axios matches it. */
export interface HttpClient {
  get<T>(url: string, config?: { params?: Record<string, string | number> }): Promise<{ data: T }>;
  patch<T>(url: string, body?: unknown): Promise<{ data: T }>;
}

/** Creates typed API functions for inverter endpoints. */
export function inverterApi(http: HttpClient) {
  /** Fetches the latest reading for an inverter. */
  async function latest(profileId: number, lang?: string): Promise<LatestReading> {
    const config = lang ? { params: { lang } } : undefined;
    const res = await http.get<LatestReading>(`/api/inverter/${profileId}/latest`, config);
    return res.data;
  }

  /** Fetches historical readings for an inverter. */
  async function history(
    profileId: number,
    query: { from: string; to: string; readings: readonly CommonReading[]; points?: number }
  ): Promise<History> {
    const params: Record<string, string | number> = {
      from: query.from,
      to: query.to,
      readings: query.readings.join(','),
    };
    if (query.points !== undefined) {
      params.points = query.points;
    }
    const res = await http.get<History>(`/api/inverter/${profileId}/history`, { params });
    return res.data;
  }

  /** Fetches energy totals for an inverter. */
  async function energy(profileId: number, range: { from: string; to: string }): Promise<EnergyTotals> {
    const res = await http.get<EnergyTotals>(`/api/inverter/${profileId}/energy`, {
      params: { from: range.from, to: range.to },
    });
    return res.data;
  }

  /** Fetches the current authenticated user. */
  async function me(): Promise<AuthUser> {
    const res = await http.get<AuthUser>('/api/auth/me');
    return res.data;
  }

  /** Updates an inverter profile. */
  async function updateProfile(profileId: number, changes: Partial<InverterProfile>): Promise<InverterProfile> {
    const res = await http.patch<InverterProfile>(`/api/inverter/profiles/${profileId}`, changes);
    return res.data;
  }

  return {
    latest,
    history,
    energy,
    me,
    updateProfile,
  };
}

export type InverterApi = ReturnType<typeof inverterApi>;
