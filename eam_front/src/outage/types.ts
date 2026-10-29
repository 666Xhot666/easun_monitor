/** An inverter's address on the outage site and what the reader found for it. */
export interface OutageSource {
  id: number;
  site: string;
  city: string;
  street: string;
  house: string;
  enabled: boolean;
  houseState: HouseState;
  groups: string[];
  lastSeenAt: string | null;
}

export type HouseState = 'PENDING' | 'FOUND' | 'NOT_FOUND';

export type WindowStatus = 'off' | 'possible' | 'unknown';

export interface ForecastWindow {
  start: string;
  end: string;
  status: WindowStatus;
  source: 'schedule' | 'repair' | 'weekly';
  description: string | null;
}

export type ForecastState = 'fresh' | 'stale' | 'none' | 'disabled' | 'pending' | 'not-found' | 'no-groups';

/** Today and tomorrow's outage windows, as GET .../outage-forecast returns them. */
export interface OutageForecast {
  state: ForecastState;
  groups: string[];
  lastOkAt: string | null;
  dataAgeMinutes: number | null;
  lastCheck: { checkedAt: string; outcome: string; error: string | null } | null;
  windows: ForecastWindow[];
  now: { status: 'on' | WindowStatus; window: ForecastWindow | null };
  next: ForecastWindow | null;
}
