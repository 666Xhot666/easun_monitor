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
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: number;
  email: string;
  createdAt: string;
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
