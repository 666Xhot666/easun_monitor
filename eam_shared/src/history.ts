/** Response of GET /api/inverter/:profileId/history. */
export interface History {
  source: 'raw' | 'hourly';
  bucketSeconds: number;
  points: { timestamp: string; values: Record<string, number> }[];
}
