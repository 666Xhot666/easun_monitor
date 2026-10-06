export type BatteryType = 'LIFEPO4' | 'LEAD_ACID' | 'GEL' | 'USER_DEFINED';

export interface InverterProfile {
  id: number;
  name: string;
  ipAddress: string;
  port: number;
  ratedPowerWatts: number;
  batteryNominalVoltage: number;
  batteryCapacityAh: number;
  batteryType: BatteryType;
  lowBatteryCutoffVoltage: number | null;
  bulkChargeVoltage: number | null;
  floatChargeVoltage: number | null;
  /** The solar array: one panel type, panels in series per string, parallel strings. */
  pvPanelTypeId: number | null;
  pvPanelsInSeries: number | null;
  pvStrings: number | null;
  /** The inverter's PV input limits, from its datasheet. */
  pvMaxVocV: number | null;
  pvMpptMinV: number | null;
  pvMpptMaxV: number | null;
  pvMaxPowerW: number | null;
  pvMaxCurrentA: number | null;
  householdId: number;
  /** The user's role in this inverter's household: readers cannot change anything. */
  role: HouseholdRole;
  createdAt: string;
  updatedAt: string;
}

export type HouseholdRole = 'ADMIN' | 'READER';

export interface AuthUser {
  id: number;
  email: string;
  createdAt: string;
  /** The household this user administers, or null (invited users). */
  adminHouseholdId: number | null;
  households: { id: number; name: string; role: HouseholdRole }[];
  /** The inverters of all the user's households. */
  inverterProfiles: InverterProfile[];
}

export interface AuthResponse {
  accessToken: string;
  user: {
    id: number;
    email: string;
  };
}

/** Shape returned by every API error this app's backend produces (Nest's
 * default HttpException JSON body). */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}
