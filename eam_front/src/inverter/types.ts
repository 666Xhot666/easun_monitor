/** A stored poll result, as returned by GET /api/inverter/:profileId/latest. */
export interface LatestReading {
  id: number;
  /** When the server polled it (ISO 8601). */
  timestamp: string;
  /** Register name -> value (enum registers hold their option index). */
  payload: Record<string, number>;
}
