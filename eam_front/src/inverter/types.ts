/** A stored poll result, as returned by GET /api/inverter/:profileId/latest. */
export interface LatestReading {
  id: number;
  /** When the server polled it (ISO 8601). */
  timestamp: string;
  /** Register name -> value (enum registers hold their option index). */
  payload: Record<string, number>;
  /** Active fault and warning descriptions, decoded by the server. */
  alerts?: { faults: string[]; warnings: string[] };
}

/** One register, as served by GET /api/inverter/registers. */
export interface RegisterDefinition {
  name: string;
  label: string;
  address: number;
  type: 'uint16' | 'int16' | 'uint32';
  scale?: number;
  unit?: string;
  options?: readonly string[];
  group: 'telemetry' | 'settings' | 'status';
  writable?: boolean;
  min?: number;
  max?: number;
}
